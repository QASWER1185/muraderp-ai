import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createRickshawRouter } from "../src/routes/rickshaw.routes.js";

const org = "61000000-0000-4000-8000-000000000001", branch = "62000000-0000-4000-8000-000000000001", actor = "63000000-0000-4000-8000-000000000001";
const headers = { "X-Organization-Id": org, "X-Branch-Id": branch };
const db = new PGlite({ extensions: { pg_trgm } });
const root = new URL("../../", import.meta.url);
beforeAll(async () => {
  // Load schema only. No historical regression scripts or seed suites run.
  await db.exec(await readFile(new URL("scripts/database-test-bootstrap.sql", root), "utf8"));
  for (const name of (await readdir(new URL("supabase/migrations/", root))).filter(n => n.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL("supabase/migrations/" + name, root), "utf8"));
  }
}, 180000);
afterAll(async () => { await db.close(); });

it("TEST-D1: two trips owe 3800, payout clears balance, no P&L or stock changes, and test data is removed", async () => {
  await db.exec("begin");
  try {
    await db.exec(`
      insert into auth.users(id) values('${actor}');
      insert into public.organizations(id,name,slug) values('${org}','Rickshaw smoke','rickshaw-smoke');
      insert into public.organization_memberships(organization_id,user_id,role,status) values('${org}','${actor}','owner','active');
      insert into public.branches(id,organization_id,code,name,status) values('${branch}','${org}','SMOKE','Smoke branch','active');
      insert into public.branch_access_grants(organization_id,branch_id,user_id,status) values('${org}','${branch}','${actor}','active');
      with p as (insert into public.products(organization_id,name,sku,category,unit,purchase_price,sale_price) values('${org}','Untouched stock','RICKSHAW-STOCK','Test','bags',100,120) returning id),
           w as (insert into public.warehouses(organization_id,name) values('${org}','Smoke warehouse') returning id)
      insert into public.inventory(organization_id,product_id,warehouse_id,quantity) select '${org}',p.id,w.id,7 from p,w;
    `);
    const snapshot = async () => (await db.query(`select
      (select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from public.inventory i) inventory,
      (select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]') from public.stock_movements m) movements,
      (select coalesce(sum(l.credit-l.debit),0) from public.journal_lines l join public.accounts a on a.id=l.account_id where a.account_type in ('REVENUE','EXPENSE')) profit_loss`)).rows;
    const before = await snapshot();
    const app = express(); app.use(express.json());
    app.use("/api/v1", createRickshawRouter({
      authenticate: (req, _res, next) => { req.browserPrincipal = { userId: actor }; next(); },
      tenantAuthorizer: { assertAuthorized: async () => {} },
      rpc: async (name, args) => {
        await db.exec("savepoint api_request");
        try {
          const entries = Object.entries(args);
          const result = await db.query<{ data: unknown }>(`select public.${name}(${entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) data`, entries.map(([, v]) => typeof v === "object" && v !== null ? JSON.stringify(v) : v));
          await db.exec("release savepoint api_request"); return { data: result.rows[0]?.data, error: null };
        } catch (error: any) {
          await db.exec("rollback to savepoint api_request; release savepoint api_request"); return { data: null, error: { code: error.code, message: error.message } };
        }
      },
    }));
    app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 400).json({ error: { message: error.message } }));
    const driver = await request(app).post("/api/v1/drivers").set(headers).send({ name: "TEST-D1" });
    expect(driver.status, JSON.stringify(driver.body)).toBe(201);
    const first = await request(app).post("/api/v1/trips").set(headers).set("Idempotency-Key", "smoke-trip-1").send({ driver_id: driver.body.data.id, material: "cement", quantity: 50, unit: "bags", rate_type: "FIXED", rate: 800 });
    expect(first.status, JSON.stringify(first.body)).toBe(201); expect(Number(first.body.data.amount)).toBe(800);
    const second = await request(app).post("/api/v1/trips").set(headers).set("Idempotency-Key", "smoke-trip-2").send({ driver_id: driver.body.data.id, material: "sand", quantity: 2, unit: "trolley", rate_type: "PER_UNIT", rate: 1500 });
    expect(second.status, JSON.stringify(second.body)).toBe(201); expect(Number(second.body.data.amount)).toBe(3000);
    const date = first.body.data.date;
    const summary = await request(app).get("/api/v1/trips/daily-summary?date=" + date).set(headers);
    expect(summary.status, JSON.stringify(summary.body)).toBe(200);
    expect(Number(summary.body.data.totals.trips)).toBe(2); expect(Number(summary.body.data.totals.owed)).toBe(3800);
    expect(summary.body.data.drivers[0].materials).toHaveLength(2);
    const payout = await request(app).post("/api/v1/trips/payments").set(headers).set("Idempotency-Key", "smoke-payout").send({ driver_id: driver.body.data.id, date, amount: 3800 });
    expect(payout.status, JSON.stringify(payout.body)).toBe(201);
    const paid = await request(app).get("/api/v1/trips/daily-summary?date=" + date).set(headers);
    expect(Number(paid.body.data.totals.paid)).toBe(3800); expect(Number(paid.body.data.totals.balance)).toBe(0);
    expect((await request(app).delete("/api/v1/trips/" + first.body.data.id).set(headers)).status).toBe(409);
    expect(await snapshot()).toEqual(before);
    const accounts = (await db.query<{ code: string; net: string }>(`select a.code,sum(l.debit-l.credit)::text net from public.journal_lines l join public.accounts a on a.id=l.account_id join public.journal_entries j on j.id=l.journal_entry_id where j.organization_id=$1 group by a.code order by a.code`, [org])).rows;
    expect(accounts.map(r => r.code)).toEqual(["1010", "2150"]); expect(accounts.every(r => Number(r.net) === 0)).toBe(true);
  } finally {
    // Paid trips cannot be deleted through the API. Roll back the disposable
    // smoke transaction to remove the driver, both trips, payout and journals.
    await db.exec("rollback");
  }
  expect((await db.query("select count(*)::int n from public.drivers where name='TEST-D1'")).rows[0]).toEqual({ n: 0 });
  expect((await db.query("select (select count(*) from public.rickshaw_trips)::int trips,(select count(*) from public.driver_payments)::int payouts")).rows[0]).toEqual({ trips: 0, payouts: 0 });
}, 60000);

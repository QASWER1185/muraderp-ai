import {readFile,readdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {pg_trgm} from "@electric-sql/pglite/contrib/pg_trgm";
import express from "express";
import request from "supertest";
import {createAccountingBrowserRouter} from "../src/routes/accounting.browser.routes.js";
import type {AccountingBrowserRepository} from "../src/repositories/accounting-browser.repository.js";
import {expect,it} from "vitest";
import {projectFinancialReport} from "../src/reports/supabase-reporting.gateway.js";

it("posts and voids the marked expense and drawing in an isolated ledger",async()=>{
  const db=new PGlite({extensions:{pg_trgm}});
  try{
    await db.exec(await readFile("../scripts/database-test-bootstrap.sql","utf8"));
    for(const file of (await readdir("../supabase/migrations")).filter(f=>f.endsWith(".sql")).sort()){
      await db.exec(await readFile("../supabase/migrations/"+file,"utf8"));
    }
    await db.exec("begin");
    const org="12000000-0000-4000-8000-000000000001", branch="12000000-0000-4000-8000-000000000002", actor="12000000-0000-4000-8000-000000000003";
    await db.exec(`
      insert into auth.users(id) values('${actor}');
      insert into organizations(id,name,slug) values('${org}','TEST Expense Register','test-expense-register');
      insert into organization_memberships(organization_id,user_id,role,status) values('${org}','${actor}','owner','active');
      insert into branches(id,organization_id,code,name,status) values('${branch}','${org}','TEST','TEST Branch','active');
      insert into branch_access_grants(organization_id,branch_id,user_id,status) values('${org}','${branch}','${actor}','active');
    `);
    const {rows:accounts}=await db.query<any>("select code,name,account_type,normal_balance from accounts order by code");
    const app=express();
    app.use(express.json(),createAccountingBrowserRouter({
      authenticate:(req,_res,next)=>{req.browserPrincipal={userId:actor};next();},
      tenantAuthorizer:{assertAuthorized:async()=>{}},
      repository:{listAccounts:async()=>accounts} as AccountingBrowserRepository,
      expenseRpc:async(name,args)=>{
        const entries=Object.entries(args);
        const {rows}=await db.query<{data:unknown}>(`select public.${name}(${entries.map(([key],i)=>key+"=> $"+(i+1)).join(",")}) data`,entries.map(([,value])=>value));
        return {data:rows[0]?.data,error:null};
      },
    }));
    const headers={"X-Organization-Id":org,"X-Branch-Id":branch};
    const response=await request(app).get("/accounts").set(headers);
    expect(response.status).toBe(200);
    expect(response.body.data.filter((a:{code:string})=>["5100","5110","5120","3100","3110","3120","3130","3140"].includes(a.code))).toHaveLength(8);
    async function report(){
      const {rows}=await db.query<any>("select journal_entry_id,entry_date::text,source_type,code,debit,credit from general_ledger where organization_id=$1 and branch_id=$2",[org,branch]);
      return projectFinancialReport(accounts,rows,{from:"2026-11-01",to:"2026-11-30"});
    }
    const posting=async(key:string,kind:string,category:string,amount:number)=>{
      const response=await request(app).post("/expenses").set(headers).set("Idempotency-Key",key)
        .send({date:"2026-11-26",kind,category,funding:"1000",amount,notes:"TEST isolated expense smoke"});
      expect(response.status).toBe(201);
      return response.body.data.id as string;
    };
    const before=await report();
    const rent=await posting("test-rent","expense","5100",5000);
    expect(await posting("test-rent","expense","5100",5000)).toBe(rent);
    const expense=await report();
    expect(expense.summary.cashAndBank).toBe("-5000.0000");
    expect(expense.summary.monthEnd).toMatchObject({operatingExpenses:"5000.0000",netBusinessProfit:"-5000.0000"});
    const kitchen=await posting("test-kitchen","drawings","3120",2000);
    const drawing=await report();
    expect(drawing.summary.cashAndBank).toBe("-7000.0000");
    expect(drawing.summary.monthEnd).toMatchObject({operatingExpenses:"5000.0000",netBusinessProfit:"-5000.0000",totalDrawings:"2000.0000",remaining:"-7000.0000"});
    for(const id of [rent,kitchen,rent])expect((await request(app).post("/expenses/"+id+"/void").set(headers)).status).toBe(200);
    const history=await request(app).get("/expenses?from=2026-11-01&to=2026-11-30").set(headers);
    expect(history.status).toBe(200);
    expect(history.body.data.map((r:{status:string})=>r.status)).toEqual(["VOIDED","VOIDED"]);
    const after=await report();
    const balances=(r:typeof before)=>JSON.stringify(r.trialBalance.map(a=>[a.code,a.net_balance]));
    expect(balances(after)).toBe(balances(before));
    expect(after.summary.monthEnd).toEqual(before.summary.monthEnd);
    expect([before.summary.totalDebits,before.summary.totalCredits]).toEqual(["0.0000","0.0000"]);
    expect([after.summary.totalDebits,after.summary.totalCredits]).toEqual(["14000.0000","14000.0000"]);
    const hash=(r:typeof before)=>createHash("sha256").update(balances(r)).digest("hex");
    console.log(JSON.stringify({beforeHash:hash(before),afterHash:hash(after),beforeDebits:before.summary.totalDebits,beforeCredits:before.summary.totalCredits,afterDebits:after.summary.totalDebits,afterCredits:after.summary.totalCredits}));
    await db.exec("rollback");
  }finally{await db.close();}
},120000);

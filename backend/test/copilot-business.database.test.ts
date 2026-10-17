import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { resolveCandidates, type RankedEntity } from "../src/services/entity-search.service.js";
import type { CustomerLedger } from "../src/repositories/copilot-business.repository.js";

const user="11111111-1111-4111-8111-111111111111";
const org="22222222-2222-4222-8222-222222222222";
const branch="33333333-3333-4333-8333-333333333333";
const other="44444444-4444-4444-8444-444444444444";
let db:PGlite;
const migration=(name:string)=>readFileSync(resolve(process.cwd(),"../supabase/migrations",name),"utf8");
async function ledger(customer=19,limit=10,cursor:number|null=null,organization=org,branchId=branch,userId:string|null=user){
  return (await db.query<{value:CustomerLedger}>("select public.copilot_customer_ledger($1,$2,$3,$4,$5,$6) value",[userId,organization,branchId,customer,limit,cursor])).rows[0]!.value;
}
async function vendors(query:string,limit=10,organization=org,branchId=branch,userId:string|null=user){
  return (await db.query<RankedEntity>("select * from public.search_vendors_fuzzy($1,$2,$3,$4,$5)",[userId,organization,branchId,query,limit])).rows;
}
beforeAll(async()=>{
  db=new PGlite({extensions:{pg_trgm}});
  await db.exec(`
    create schema private;create role anon;create role authenticated;create role service_role bypassrls;
    create table organization_memberships(user_id uuid,organization_id uuid,role text,status text);
    create table role_permissions(role text,permission_code text);
    create table branches(id uuid,organization_id uuid,status text);
    create table branch_access_grants(user_id uuid,organization_id uuid,branch_id uuid,status text);
    create table brands(id bigint primary key,organization_id uuid,name text);
    create table products(id bigint primary key,organization_id uuid,name text,sku text,unit text,category text,brand_id bigint);
    create table customers(id bigint primary key,organization_id uuid,name varchar(255),city varchar(100),phone varchar(50));
    create table vendors(id bigint primary key,organization_id uuid,name varchar(255));
    create table invoices(id bigint primary key,organization_id uuid,branch_id uuid,customer_id bigint);
    create table purchases(id bigint primary key,organization_id uuid,branch_id uuid,vendor_id bigint);
    create table customer_ledger_entries(id bigint primary key,organization_id uuid,branch_id uuid,customer_id bigint,entry_type text,reference_type text,reference_id bigint,debit numeric,credit numeric,currency_code text,entry_date date,description text);
    create table journal_entries(id uuid primary key,organization_id uuid,branch_id uuid,entry_date date,source_type text,source_record_id text,status text);
    insert into organization_memberships values('${user}','${org}','owner','active');
    insert into role_permissions values('owner','customers.read'),('owner','products.read'),('owner','vendors.read'),('owner','accounting.read');
    insert into branches values('${branch}','${org}','active'),('${other}','${org}','active');
    insert into branch_access_grants values('${user}','${org}','${branch}','active');
    insert into customers values(19,'${org}','Qasim','Lake City',null),(20,'${org}','Empty','Lahore',null),(21,'${org}','Zero','DHA',null),(99,'${other}','Secret',null,null);
    insert into vendors values(8,'${org}','Popular Supplier'),(9,'${org}','Dura Supplier'),(10,'${org}','Twin'),(11,'${org}','Twin'),(12,'${other}','Popular Secret');
    insert into customer_ledger_entries values
      (1,'${org}','${branch}',19,'INVOICE','INVOICE',501,1000,0,'PKR','2026-10-01','Invoice'),
      (2,'${org}','${branch}',19,'PAYMENT','CUSTOMER_PAYMENT',701,0,200,'PKR','2026-10-04','Receipt'),
      (3,'${org}','${branch}',19,'INVOICE','INVOICE',502,50,0,'USD','2026-10-05','USD invoice'),
      (4,'${org}','${branch}',21,'INVOICE','INVOICE',503,200,0,'PKR','2026-10-01',null),
      (5,'${org}','${branch}',21,'PAYMENT','CUSTOMER_PAYMENT',702,0,200,'PKR','2026-10-02',null),
      (6,'${org}','${other}',19,'PAYMENT','CUSTOMER_PAYMENT',703,0,9999,'PKR','2026-10-06','Wrong branch'),
      (7,'${other}','${branch}',19,'INVOICE','INVOICE',504,9999,0,'PKR','2026-10-06','Wrong organization'),
      (8,'${org}','${branch}',20,'INVOICE','INVOICE',505,8888,0,'PKR','2026-10-06','Another customer');
    -- Keep the empty-customer fixture empty, with another customer for isolation.
    update customer_ledger_entries set customer_id=22 where id=8;
    insert into journal_entries values
      ('55555555-5555-4555-8555-555555555555','${org}','${branch}','2026-10-04','CUSTOMER_PAYMENT','701','POSTED'),
      ('66666666-6666-4666-8666-666666666666','${org}','${other}','2026-10-04','CUSTOMER_PAYMENT','701','POSTED'),
      ('77777777-7777-4777-8777-777777777777','${other}','${branch}','2026-10-04','CUSTOMER_PAYMENT','701','POSTED'),
      ('88888888-8888-4888-8888-888888888888','${org}','${branch}','2026-10-04','CUSTOMER_PAYMENT','701','DRAFT');
    alter table customer_ledger_entries enable row level security;
    alter table vendors enable row level security;
    grant select on all tables in schema public to service_role;
  `);
  const auth=migration("20260829062845_p0_5_membership_branch_access_foundation.sql");
  await db.exec(auth.slice(auth.indexOf("create or replace function public.is_organization_member_for_user"),auth.indexOf("-- User-context helpers")));
  await db.exec(migration("20261005090000_phase2a_entity_search.sql"));
  await db.exec(migration("20261005093000_phase2a_entity_search_result_types.sql"));
  await db.exec(migration("20261005110000_phase2c_business_reads.sql"));
  await db.exec("set role service_role");
},120000);
afterAll(async()=>{await db?.close();});
describe("Part 3 actual PostgreSQL read-only integration",()=>{
  it("aggregates the entire customer branch subledger by currency with history pagination",async()=>{
    const first=await ledger(19,1);
    expect(first.balances).toEqual([{currency_code:"PKR",debit:1000,credit:200,outstanding:800},{currency_code:"USD",debit:50,credit:0,outstanding:50}]);
    expect(first.transactions.map(row=>row.id)).toEqual([3]);expect(first.nextCursor).toBe(3);
    const next=await ledger(19,1,first.nextCursor);
    expect(next.transactions.map(row=>row.id)).toEqual([2]);expect(next.balances).toEqual(first.balances);
    const final=await ledger(19,1,next.nextCursor);
    expect(final.transactions.map(row=>row.id)).toEqual([1]);expect(final.nextCursor).toBeNull();
  });
  it("returns latest payment independently of the history page and excludes other branches/customers",async()=>{
    const result=await ledger(19,1);
    expect(result.latestPayment).toEqual({id:2,date:"2026-10-04",amount:200,currencyCode:"PKR",referenceId:701});
    expect(result.transactions).toHaveLength(1);expect(result.balances[0]?.outstanding).toBe(800);
  });
  it("joins only posted scoped canonical journals for exact source references",async()=>{
    const result=await ledger(19,20);
    expect(result.transactions.find(row=>row.id===2)?.journals).toEqual([{id:"55555555-5555-4555-8555-555555555555",date:"2026-10-04",sourceType:"CUSTOMER_PAYMENT",status:"POSTED"}]);
  });
  it("distinguishes an empty ledger from a known zero balance",async()=>{
    expect(await ledger(20)).toMatchObject({balances:[],transactions:[],latestPayment:null,nextCursor:null});
    expect(await ledger(21)).toMatchObject({balances:[{outstanding:0}]});
  });
  it.each(["user","organization","branch","null user"])("denies invalid %s scope inside the service-role RPC",async field=>{
    await expect(ledger(19,10,null,field==="organization"?other:org,field==="branch"?other:branch,field==="null user"?null:field==="user"?other:user)).rejects.toMatchObject({code:"42501"});
    await expect(vendors("Popular",10,field==="organization"?other:org,field==="branch"?other:branch,field==="null user"?null:field==="user"?other:user)).rejects.toMatchObject({code:"42501"});
  });
  it.each(["accounting.read","customers.read","vendors.read"])("fails closed after permission %s is revoked",async permission=>{
    await db.exec(`reset role;delete from role_permissions where permission_code='${permission}';set role service_role;`);
    try { await expect(permission==="vendors.read"?vendors("Popular"):ledger()).rejects.toMatchObject({code:"42501"}); }
    finally { await db.exec(`reset role;insert into role_permissions values('owner','${permission}');set role service_role;`); }
  });
  it("rejects missing/cross-organization customer IDs",async()=>{
    await expect(ledger(999)).rejects.toMatchObject({code:"22023"});await expect(ledger(99)).rejects.toMatchObject({code:"22023"});
  });
  it("resolves vendor varchar names, fuzzy queries and ties without returning a catalog",async()=>{
    expect(resolveCandidates(await vendors("Popular Supplier"),5)).toMatchObject({resolution:"resolved",bestCandidate:{id:8}});
    expect((await vendors("Poplar supplier"))[0]?.id).toBe(8);
    expect(resolveCandidates(await vendors("Twin",1),1)).toMatchObject({resolution:"ambiguous",bestCandidate:null,hasMore:true});
    expect((await vendors("Popular")).some(row=>row.id===12)).toBe(false);
  });
  it("bounds database results and does not invent nonexistent vendors",async()=>{
    expect((await ledger(19,999)).transactions.length).toBeLessThanOrEqual(20);
    expect(await vendors("x".repeat(121))).toEqual([]);expect(await vendors("unicorn xyz")).toEqual([]);
    expect(await vendors("*")).toEqual([]);
  });
  it("denies anonymous/browser RPC execution and preserves RLS and ledger records",async()=>{
    for(const role of ["anon","authenticated"]){
      await db.exec("reset role;set role "+role);
      await expect(ledger()).rejects.toMatchObject({code:"42501"});await expect(vendors("Popular")).rejects.toMatchObject({code:"42501"});
    }
    await db.exec("reset role");
    expect((await db.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where relname in ('vendors','customer_ledger_entries')")).rows.every(row=>row.relrowsecurity)).toBe(true);
    expect((await db.query<{count:number}>("select count(*)::integer count from customer_ledger_entries")).rows[0]?.count).toBe(8);
    await db.exec("set role service_role");
  });
  it("enforces revoked branch grants inside both read RPCs",async()=>{
    await db.exec("reset role;update branch_access_grants set status='inactive';set role service_role");
    try {await expect(ledger()).rejects.toMatchObject({code:"42501"});await expect(vendors("Popular")).rejects.toMatchObject({code:"42501"});}
    finally {await db.exec("reset role;update branch_access_grants set status='active';set role service_role");}
  });
});

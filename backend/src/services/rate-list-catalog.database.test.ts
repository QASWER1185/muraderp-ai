import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("atomically imports all catalog rows, keeps gross rates and discount separate, replays safely and rolls back invalid rows", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table organizations(id uuid primary key);
      create table brands(id bigint generated always as identity primary key,organization_id uuid,name text);
      create table products(id bigint generated always as identity primary key,organization_id uuid,brand_id bigint references brands(id),name text,sku text unique,category text,unit text,purchase_price numeric,sale_price numeric);
      create table rate_lists(id bigint generated always as identity primary key,organization_id uuid,name text,code text,price_type text,scope_type text,currency_code text,is_active boolean);
      create table rate_list_versions(id bigint generated always as identity primary key,rate_list_id bigint references rate_lists(id),version_number integer,status text,effective_from timestamptz,effective_to timestamptz);
      create unique index active_version on rate_list_versions(rate_list_id) where status='ACTIVE';
      create table rate_list_items(id bigint generated always as identity primary key,rate_list_version_id bigint references rate_list_versions(id),product_id bigint references products(id),minimum_quantity numeric,unit_price numeric,unit text,unique(rate_list_version_id,product_id,minimum_quantity));
      insert into organizations values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
    `);
    await db.exec(await readFile(new URL("../../../supabase/migrations/20261019090000_copilot_catalog_import.sql",import.meta.url),"utf8"));
    const catalog={documentType:"rate_list",name:"Dura Flow PPRC",complete:true,standardDiscountPercent:50,items:Array.from({length:132},(_,i)=>({brand:"Dura Flow",category:"Fittings",name:"Socket",size:i+"mm",unit:"pcs",list_price:43+i}))};
    const run=(key:string,value:unknown=catalog,org="11111111-1111-4111-8111-111111111111")=>db.query<{result:any}>("select import_rate_list_catalog($1,$2,$3::jsonb) result",[org,key,JSON.stringify(value)]);
    const first=(await run("catalog-1")).rows[0]!.result;
    expect(first.items).toHaveLength(132);expect(first.version).toMatchObject({status:"ACTIVE",standard_discount_percent:50});expect(Number(first.items[0].unit_price)).toBe(43);
    expect((await run("catalog-1")).rows[0]!.result).toEqual(first);
    await expect(run("catalog-1",{...catalog,name:"Changed"})).rejects.toThrow("idempotency conflict");
    const bad={...catalog,name:"Invalid catalog",items:[catalog.items[0],{...catalog.items[1],list_price:-1}]};
    await expect(run("catalog-bad",bad)).rejects.toThrow("Invalid catalog row");
    expect((await db.query<{count:number}>("select count(*)::int count from rate_lists")).rows[0]!.count).toBe(1);
    await run("catalog-other",catalog,"22222222-2222-4222-8222-222222222222");
    expect((await db.query<{count:number}>("select count(*)::int count from products")).rows[0]!.count).toBe(264);
    const revised=(await run("catalog-2",{...catalog,items:catalog.items.map(item=>({...item,list_price:item.list_price+1}))})).rows[0]!.result;
    expect(revised.version.version_number).toBe(2);
    expect((await db.query<{status:string}>("select status from rate_list_versions where id=$1",[first.version.id])).rows[0]!.status).toBe("ARCHIVED");
    expect((await db.query<{count:number}>("select count(*)::int count from products")).rows[0]!.count).toBe(264);
  } finally { await db.close(); }
},120000);

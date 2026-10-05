import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { resolveCandidates, type RankedEntity } from "../src/services/entity-search.service.js";

const user = "11111111-1111-4111-8111-111111111111";
const org = "22222222-2222-4222-8222-222222222222";
const branch = "33333333-3333-4333-8333-333333333333";
const other = "44444444-4444-4444-8444-444444444444";
let db: PGlite;
const migration = readFileSync(resolve(process.cwd(),"../supabase/migrations/20261005090000_phase2a_entity_search.sql"),"utf8");
async function search(kind: "products" | "customers", query: string, limit=10, organization=org, branchId=branch, userId=user) {
  return (await db.query<RankedEntity & {sku:string;unit:string;category:string;brand_name:string;city:string}>(
    `select * from public.search_${kind}_fuzzy($1,$2,$3,$4,$5)`,[userId,organization,branchId,query,limit])).rows;
}

beforeAll(async () => {
  db = new PGlite({extensions:{pg_trgm}});
  // Minimal ERP fixture schema; execute the actual P0-5 authorization helpers and
  // Phase 2 migration rather than duplicating matching logic in JavaScript.
  await db.exec(`
    create schema private;
    create role anon; create role authenticated; create role service_role bypassrls;
    create table organization_memberships(user_id uuid,organization_id uuid,role text,status text);
    create table role_permissions(role text,permission_code text);
    create table branches(id uuid,organization_id uuid,status text);
    create table branch_access_grants(user_id uuid,organization_id uuid,branch_id uuid,status text);
    create table brands(id bigint primary key,organization_id uuid,name text);
    create table products(id bigint primary key,organization_id uuid,name text,sku text,unit text,category text,brand_id bigint);
    create table customers(id bigint primary key,organization_id uuid,name text,city text,phone text);
    insert into organization_memberships values('${user}','${org}','owner','active');
    insert into role_permissions values('owner','products.read'),('owner','customers.read');
    insert into branches values('${branch}','${org}','active'),('${other}','${org}','active');
    insert into branch_access_grants values('${user}','${org}','${branch}','active');
    insert into brands values(1,'${org}','POPULAR'),(2,'${org}','DURA'),(3,'${other}','SECRET BRAND');
    insert into products values
      (1,'${org}','POPULAR PPR-C ELBOW FEMALE 25×1/2','POP-EF-25','PCS','Fittings',1),
      (2,'${org}','POPULAR PPR-C ELBOW FEMALE 32×1/2','POP-EF-32','PCS','Fittings',1),
      (3,'${org}','DURA PPR C ELBOW FEMALE 25x1/2','DUR-EF-25','PCS','Fittings',2),
      (4,'${org}','POPULAR PPR-100 PIPE PN-20 25MM','PIPE-25','MTR','Pipe',1),
      (5,'${org}','POPULAR PPR-100 PIPE PN16 25MM','PIPE-16','MTR','Pipe',1),
      (6,'${other}','SECRET ELBOW FEMALE 25x1/2','SECRET','PCS','Fittings',3),
      (7,'${org}','COUPLING 20MM','C20','PCS','Fittings',1);
    insert into customers values
      (1,'${org}','Qasim','Lake City','0300-1111111'),
      (2,'${org}','Qasim','DHA','0300-2222222'),
      (3,'${org}','Ahmed Traders','Lahore','0300-3333333'),
      (4,'${org}','قاسم','Multan','0300-4444444'),
      (5,'${other}','Qasim Secret','Secret City','0300-5555555');
    create index products_org_fixture on products(organization_id);
    create index customers_org_fixture on customers(organization_id);
    alter table products enable row level security;
    alter table customers enable row level security;
    grant select on all tables in schema public to service_role;
  `);
  const auth = readFileSync(resolve(process.cwd(),"../supabase/migrations/20260829062845_p0_5_membership_branch_access_foundation.sql"),"utf8");
  const helpers = auth.slice(auth.indexOf('create or replace function public.is_organization_member_for_user'),auth.indexOf('-- User-context helpers'));
  await db.exec(helpers);
  await db.exec(migration);
  await db.exec('set role service_role');
},60000);
afterAll(async () => {await db?.close();});

describe("Phase 2 PostgreSQL entity resolution",() => {
  it("prioritizes exact product names and SKUs",async () => {
    expect((await search('products','POP-EF-25'))[0]).toMatchObject({id:1,confidence:1,match_kind:'exact_sku'});
    expect(resolveCandidates(await search('products','POPULAR PPR-C ELBOW FEMALE 25×1/2'),10)).toMatchObject({resolution:'resolved',bestCandidate:{id:1}});
  });
  it.each(['EBOW','ELBOW'])('normalizes %s',async word => {
    expect((await search('products',`${word} FEMALE 25*1/2 Popular`))[0]?.id).toBe(1);
  });
  it.each(['FEM','FEMALE'])('normalizes abbreviation %s',async word => {
    expect((await search('products',`POPULAR EBOW ${word} 25*1/2`))[0]?.id).toBe(1);
  });
  it.each(['25*1/2','25x1/2','25×1/2','25 * 1 / 2'])('normalizes dimensions %s and excludes other sizes',async size => {
    const rows=await search('products',`POPULAR EBOW FEM ${size}`);
    expect(rows[0]?.id).toBe(1);expect(rows.map(r=>r.id)).not.toContain(2);
    expect(resolveCandidates(rows,10).resolution).toBe('resolved');
  });
  it.each(['pprc','PPR-C','PPR C'])('normalizes family %s',async family => {
    expect((await search('products',`POPULAR ${family} ELBOW FEM 25x1/2`))[0]?.id).toBe(1);
  });
  it.each(['Popular','POPULAR','popular'])('matches brand %s',async brand => {
    expect((await search('products',`${brand} elbow female 25x1/2`))[0]?.brand_name).toBe('POPULAR');
  });
  it("matches a misspelled brand from its separate authoritative brand record",async () => {
    expect((await search('products','Poplar elbow female 25x1/2'))[0]?.id).toBe(1);
    expect((await search('products','POPULAR coupling 20mm'))[0]?.id).toBe(7);
  });
  it("ranks partial names but requires brand clarification for close candidates even at limit 1",async () => {
    const rows=await search('products','EBOW FEMALE 25*1/2',1);
    expect(rows.map(r=>r.id)).toEqual([1,3]);
    expect(resolveCandidates(rows,1)).toMatchObject({resolution:'ambiguous',bestCandidate:null,hasMore:true});
  });
  it.each(['PN16','PN-16','pn 16'])('matches %s without choosing PN20',async pn => {
    expect((await search('products',`Popular pipe 25mm ${pn}`)).map(r=>r.id)).toEqual([5]);
  });
  it("does not invent absent products or accept a conflicting dimension",async () => {
    expect(await search('products','UNICORN XYZ 999')).toEqual([]);
    expect(await search('products','Popular elbow 250x1/2')).toEqual([]);
  });
  it("matches exact and partial customers using ERP city",async () => {
    expect(resolveCandidates(await search('customers','Ahmed Traders'),10)).toMatchObject({resolution:'resolved',bestCandidate:{id:3}});
    expect((await search('customers','Ahmed'))[0]?.id).toBe(3);
    expect(resolveCandidates(await search('customers','Qasim Lake City'),10)).toMatchObject({resolution:'resolved',bestCandidate:{id:1}});
  });
  it.each(['Qasim','Qasim sahib','قاسم','قاسم صاحب'])('supports %s and preserves ambiguity',async query => {
    const rows=await search('customers',query);
    expect(rows.map(r=>r.id)).toEqual(expect.arrayContaining([1,2,4]));
    expect(resolveCandidates(rows,10).resolution).toBe('ambiguous');
  });
  it("allows exact phone lookup without returning phone data",async () => {
    const rows=await search('customers','0300 1111111');
    expect(rows).toEqual([expect.objectContaining({id:1,match_kind:'exact_phone'})]);
    expect(rows[0]).not.toHaveProperty('phone');
  });
  it("requires clarification for weak singleton scores",() => {
    expect(resolveCandidates([{id:7,name:'Weak',confidence:.75,match_kind:'fuzzy'}],10)).toMatchObject({resolution:'clarification',bestCandidate:null});
  });
  it.each(['products','customers'] as const)("enforces user, organization, permission and branch isolation for %s",async kind => {
    await expect(search(kind,'Qasim',10,other)).rejects.toMatchObject({code:'42501'});
    await expect(search(kind,'Qasim',10,org,other)).rejects.toMatchObject({code:'42501'});
    await expect(search(kind,'Qasim',10,org,branch,other)).rejects.toMatchObject({code:'42501'});
    await db.exec("reset role; delete from role_permissions where permission_code='"+kind+".read'; set role service_role;");
    await expect(search(kind,'Qasim')).rejects.toMatchObject({code:'42501'});
    await db.exec("reset role; insert into role_permissions values('owner','"+kind+".read'); set role service_role;");
    const rows=await search(kind,kind==='products'?'elbow female 25x1/2':'Qasim');
    expect(rows.some(r=>r.id===(kind==='products'?6:5))).toBe(false);
  });
  it("rejects browser/anonymous RPC callers and leaves RLS enabled",async () => {
    for(const role of ['anon','authenticated']) {
      await db.exec('reset role; set role '+role);
      await expect(search('products','elbow')).rejects.toMatchObject({code:'42501'});
    }
    await db.exec('reset role');
    expect((await db.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where relname in ('products','customers')")).rows.every(r=>r.relrowsecurity)).toBe(true);
    await db.exec('set role service_role');
  });
  it("fails closed for null identity and revoked or inactive branch grants",async () => {
    await expect(db.query('select * from search_products_fuzzy(null,$1,$2,$3)',[org,branch,'elbow'])).rejects.toMatchObject({code:'42501'});
    await db.exec("reset role; update branch_access_grants set status='inactive'; set role service_role;");
    await expect(search('products','elbow')).rejects.toMatchObject({code:'42501'});
    await db.exec("reset role; update branch_access_grants set status='active'; update branches set status='inactive' where id='"+branch+"'; set role service_role;");
    await expect(search('customers','Qasim')).rejects.toMatchObject({code:'42501'});
    await db.exec("reset role; update branches set status='active'; set role service_role;");
  });
  it("bounds results and query input",async () => {
    expect((await search('products','POPULAR',100000)).length).toBeLessThanOrEqual(20);
    expect(await search('products','x'.repeat(121))).toEqual([]);
    expect(await search('products','*')).toEqual([]);
  });
  it("uses trigram indexes with 20,000 rows and keeps queries bounded",async () => {
    await db.exec(`reset role; insert into products select n,'${org}','Catalog item '||n,'CAT-'||n,'PCS','General',null from generate_series(100,20100)n; analyze products;`);
    // Planner may choose a sequential scan on tiny fixtures. Check real selective
    // access with representative cardinality, without disabling sequential scans.
    const plan=await db.query<Record<string,unknown>>(`explain (analyze,buffers,format json) select id from products where organization_id='${org}' and private.entity_search_normalize(coalesce(name,'')||' '||coalesce(sku,'')||' '||coalesce(category,'')||' '||coalesce(unit,'')) operator(extensions.%>) 'elbow'`);
    expect(JSON.stringify(plan.rows)).toContain('products_entity_search_trgm');
    await db.exec('set role service_role');
    const start=performance.now();const rows=await search('products','POPULAR EBOW FEM 25*1/2');
    expect(rows[0]?.id).toBe(1);expect(rows.length).toBeLessThanOrEqual(20);
    expect(performance.now()-start).toBeLessThan(3000);
  },60000);
});

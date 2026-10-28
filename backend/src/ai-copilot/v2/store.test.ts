import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

describe('v2 disposable memory/conversation migration',()=>{
  it('creates private scoped tables, overwrites a corrected fact and rejects foreign-organization branches',async()=>{
    const db=new PGlite();
    try{
      await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
        create table auth.users(id uuid primary key);create table organizations(id uuid primary key);create table branches(id uuid primary key,organization_id uuid references organizations(id));
        insert into auth.users values('00000000-0000-4000-8000-000000000001');
        insert into organizations values('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003');
        insert into branches values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002');`);
      const sql=readFileSync(new URL('../../../../supabase/migrations/20261028090000_copilot_v2_memory_conversations.sql',import.meta.url),'utf8');
      await db.exec(sql);
      const values=`'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','shorthand','p-elbow','Plug Elbow','مالک کی تصدیق','00000000-0000-4000-8000-000000000001'`;
      await db.exec(`insert into copilot_memories(organization_id,branch_id,category,key,value,evidence,verified_by)values(${values});`);
      await db.exec(`insert into copilot_memories(organization_id,branch_id,category,key,value,evidence,verified_by)values(${values}) on conflict(organization_id,branch_id,category,key)do update set value='Corrected Plug Elbow';`);
      const rows=await db.query('select value from copilot_memories');expect(rows.rows).toEqual([{value:'Corrected Plug Elbow'}]);
      await expect(db.exec(`update copilot_memories set organization_id='00000000-0000-4000-8000-000000000003';`)).rejects.toThrow('Branch is outside');
      const access=await db.query<{allowed:boolean}>(`select has_table_privilege('authenticated','copilot_memories','select') as allowed`);expect(access.rows[0]?.allowed).toBe(false);
      const rls=await db.query<{relrowsecurity:boolean}>(`select relrowsecurity from pg_class where relname='copilot_v2_conversations'`);expect(rls.rows[0]?.relrowsecurity).toBe(true);
    }finally{await db.close();}
  },60_000);
});

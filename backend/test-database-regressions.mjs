import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

// Real migration SQL and regression SQL in a disposable embedded PostgreSQL.
// No connection to local/production databases and no persistent volume.
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const db = new PGlite({ extensions: { pg_trgm } });
const tests = [
  'database_foundation.sql',
  'accounting_ledger_foundation_v2.sql',
  'p0_8_authoritative_accounting_posting.sql',
  'products_final_gate.sql',
  'estimate_conversion.sql',
  'estimate_status_editor.sql',
  'native_demand_drafts.sql',
  'copilot_dev_seed.sql',
  'copilot_institutional_memory.sql',
  'depot_v9.sql',
];
try {
  await db.exec(await read('scripts/database-test-bootstrap.sql'));
  const migrations = (await readdir(new URL('supabase/migrations/', root)))
    .filter(name => name.endsWith('.sql')).sort();
  for (const name of migrations) {
    if (name === '20261026140000_duraflow_rate_list_storewide.sql') {
      // This data migration refers to a real imported list. Supply a scoped
      // synthetic predecessor in the disposable database before replaying it.
      await db.exec(`
        insert into organizations(id, name, slug)
          values ('f0000000-0000-4000-8000-000000000001', 'Fixture Store', 'fixture-duraflow');
        insert into customers(id, organization_id, name, phone, city) overriding system value
          values (23, 'f0000000-0000-4000-8000-000000000001', 'Fixture Customer', 'test', 'test');
        insert into rate_lists(organization_id, name, code, price_type, scope_type, customer_id)
          values ('f0000000-0000-4000-8000-000000000001', 'Fixture Dura Flow', 'DURAFLOW-C23-ERP-20261025', 'SALE', 'CUSTOMER', 23);
      `);
    }
    try { await db.exec(await read(`supabase/migrations/${name}`)); }
    catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
    if (name === '20261026140000_duraflow_rate_list_storewide.sql') {
      const { rows } = await db.query(`select scope_type, customer_id from rate_lists where code = 'DURAFLOW-C23-ERP-20261025'`);
      if (rows.length !== 1 || rows[0].scope_type !== 'GLOBAL' || rows[0].customer_id !== null) throw new Error('Dura Flow fixture was not made store-wide');
      await db.exec(`delete from rate_lists where code = 'DURAFLOW-C23-ERP-20261025';
        delete from customers where id = 23 and organization_id = 'f0000000-0000-4000-8000-000000000001';
        delete from organizations where id = 'f0000000-0000-4000-8000-000000000001';`);
    }
  }
  console.log(`Applied ${migrations.length} migrations.`, (await db.query('show server_version')).rows);
  let passed = 0;
  for (const name of tests) {
    try {
      if (name === 'copilot_dev_seed.sql') {
        // Exercise the real local reset seed twice to verify replay safety.
        await db.exec(await read('supabase/seed.sql'));
        await db.exec(await read('supabase/seed.sql'));
      }
      // psql's ON_ERROR_STOP directive has no SQL equivalent; db.exec throws.
      await db.exec((await read(`supabase/tests/${name}`)).replace(/^\\set ON_ERROR_STOP on\r?$/gm, ''));
      console.log(`PASS ${name}`);
      passed++;
    } catch (error) {
      console.error(`FAIL ${name}: ${error.message}`);
      await db.exec('rollback; reset role;');
      process.exitCode = 1;
    }
  }
  console.log(`Database regressions: ${passed}/${tests.length} PASS`);
} finally {
  await db.close();
}

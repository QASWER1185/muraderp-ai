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
];
try {
  await db.exec(await read('scripts/database-test-bootstrap.sql'));
  const migrations = (await readdir(new URL('supabase/migrations/', root)))
    .filter(name => name.endsWith('.sql')).sort();
  for (const name of migrations) {
    try { await db.exec(await read(`supabase/migrations/${name}`)); }
    catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
  }
  console.log(`Applied ${migrations.length} migrations.`, (await db.query('show server_version')).rows);
  let passed = 0;
  for (const name of tests) {
    try {
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

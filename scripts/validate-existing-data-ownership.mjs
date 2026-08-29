import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "supabase/data-ownership/p0-3-existing-data-classification.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const failures = [];
const fail = (message) => failures.push(message);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (manifest.schema_version !== 1) fail("unsupported ownership manifest schema_version");
if (manifest.decision_id !== "STEP_6_P0_3_EXISTING_DATA_OWNERSHIP_GATE") fail("unexpected decision_id");
if (manifest.source?.capture_mode !== "READ_ONLY") fail("source capture_mode must be READ_ONLY");

const policy = manifest.policy ?? {};
for (const key of [
  "automatic_ownership_backfill_allowed",
  "default_organization_assignment_allowed",
  "synthetic_branch_assignment_allowed",
  "automatic_cleanup_allowed",
  "production_data_mutation_authorized",
]) {
  if (policy[key] !== false) fail(`${key} must remain false`);
}
for (const key of [
  "unknown_rows_block_ownership_migration",
  "real_business_rows_require_explicit_organization_evidence",
  "live_snapshot_must_be_rechecked_before_any_ownership_migration",
]) {
  if (policy[key] !== true) fail(`${key} must remain true`);
}

const allowed = new Set([
  "TEST_VALIDATION",
  "UNKNOWN_REQUIRES_OWNER_DECISION",
  "REAL_BUSINESS_EXPLICITLY_PROVEN",
  "SYSTEM_TEMPLATE",
]);
const records = Array.isArray(manifest.business_records) ? manifest.business_records : [];
const seen = new Set();
let testCount = 0;
let unknownCount = 0;
let realCount = 0;

for (const row of records) {
  if (!row.table || !row.primary_key) fail("every business record requires table and primary_key");
  if (!allowed.has(row.classification)) fail(`invalid classification for ${row.table}:${row.primary_key}`);
  const identity = `${row.table}:${row.primary_key}`;
  if (seen.has(identity)) fail(`duplicate business record ${identity}`);
  seen.add(identity);

  if (row.classification === "TEST_VALIDATION") {
    testCount += 1;
    if (row.organization_id !== null || row.branch_id !== null) fail(`${identity} test data must remain unowned`);
    if (row.quarantine_action !== "PRESERVE_UNOWNED_NO_BACKFILL") fail(`${identity} test data must remain logically quarantined`);
    if (!Array.isArray(row.evidence) || !row.evidence.includes("PRINCIPAL_ARCHITECT_POSTMAN_TEST_CONTEXT")) {
      fail(`${identity} test classification lacks owner Postman evidence`);
    }
  }

  if (row.classification === "UNKNOWN_REQUIRES_OWNER_DECISION") {
    unknownCount += 1;
    if (row.organization_id !== null || row.branch_id !== null) fail(`${identity} unknown data cannot carry assumed ownership`);
  }

  if (row.classification === "REAL_BUSINESS_EXPLICITLY_PROVEN") {
    realCount += 1;
    if (!uuid.test(row.organization_id ?? "")) fail(`${identity} real business data requires explicit organization UUID`);
    if (row.branch_id !== null && row.branch_id !== undefined && !uuid.test(row.branch_id)) fail(`${identity} branch_id must be null or UUID`);
    if (!Array.isArray(row.evidence) || row.evidence.length === 0) fail(`${identity} real business data requires explicit ownership evidence`);
  }
}

const templateRows = Array.isArray(manifest.system_template_data) ? manifest.system_template_data : [];
for (const row of templateRows) {
  if (row.classification !== "SYSTEM_TEMPLATE") fail(`system template table ${row.table ?? "<unknown>"} must be SYSTEM_TEMPLATE`);
  if (!Number.isInteger(row.exact_count) || row.exact_count < 0) fail(`system template table ${row.table ?? "<unknown>"} requires exact_count`);
}

const summary = manifest.summary ?? {};
if (summary.test_validation_count !== testCount) fail("summary test_validation_count mismatch");
if (summary.unknown_count !== unknownCount) fail("summary unknown_count mismatch");
if (summary.real_business_count !== realCount) fail("summary real_business_count mismatch");
if (summary.ownership_backfill_status !== "NOT_AUTHORIZED") fail("ownership backfill must remain NOT_AUTHORIZED");
if (summary.gate_result !== "VALID_FOR_P0_3_REPOSITORY_CONTROL") fail("unexpected gate_result");

if (unknownCount > 0) fail("UNKNOWN / REQUIRES EXPLICIT OWNER DECISION records remain");

if (failures.length > 0) {
  console.error("EXISTING_DATA_OWNERSHIP_GATE_INVALID");
  for (const message of failures) console.error(`FAIL  ${message}`);
  process.exit(1);
}

console.log("EXISTING_DATA_OWNERSHIP_GATE_VALID");
console.log(`TEST_VALIDATION=${testCount}`);
console.log(`UNKNOWN=${unknownCount}`);
console.log(`REAL_BUSINESS=${realCount}`);
console.log(`SYSTEM_TEMPLATE_TABLES=${templateRows.length}`);
console.log("AUTOMATIC_OWNERSHIP_BACKFILL=BLOCKED");
console.log("LIVE_RECHECK_BEFORE_OWNERSHIP_MIGRATION=REQUIRED");

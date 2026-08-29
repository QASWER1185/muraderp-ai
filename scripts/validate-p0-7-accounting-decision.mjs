import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const decision = JSON.parse(readFileSync(resolve(root, "docs/architecture/p0-7-accounting-decision.json"), "utf8"));
const adr = readFileSync(resolve(root, "docs/architecture/P0_7_DUAL_ACCOUNTING_LEDGER_DECISION.md"), "utf8");
const failures = [];
const pass = (message) => console.log(`PASS  ${message}`);
const fail = (message) => failures.push(message);
const assert = (condition, message) => condition ? pass(message) : fail(message);

assert(decision.authoritative_accounting_model.journal_entries_table === "public.journal_entries", "journal_entries is authoritative");
assert(decision.authoritative_accounting_model.journal_lines_table === "public.journal_lines", "journal_lines is authoritative");
assert(decision.authoritative_accounting_model.accounts_table === "public.accounts", "accounts is authoritative chart of accounts");
assert(decision.authoritative_accounting_model.financial_reports_must_read_only_this_model === true, "financial reports have one accounting truth");
assert(decision.legacy_accounting_model.classification === "LEGACY_NON_AUTHORITATIVE", "legacy accounting journal is explicitly non-authoritative");
assert(decision.legacy_accounting_model.future_writes_allowed === false, "future legacy journal writes are forbidden");
assert(decision.posting_boundary.mode === "SINGLE_DATABASE_TRANSACTION", "posting boundary is atomic");
assert(decision.posting_boundary.failure_semantics === "ROLLBACK_ALL", "partial accounting commits are forbidden");
assert(decision.double_entry.posted_journal_must_balance === true, "posted journal must balance");
assert(decision.double_entry.total_debits_equal_total_credits === true, "debit equals credit invariant is mandatory");
assert(decision.corrections.posted_journal_lines_immutable === true, "posted journal lines are immutable");
assert(decision.corrections.reversal_entry_required === true, "corrections require reversal entries");
assert(decision.subledgers.independent_accounting_truth === false, "customer/vendor subledgers are projections, not accounting truth");
assert(decision.inventory.costing_method === "UNDECIDED_SEPARATE_DECISION", "P0-7 does not invent a costing method");
assert(decision.source_link.required_tuple.join("|") === "organization_id|source_type|source_record_id|posting_kind", "source linkage is organization-aware and deterministic");
assert(decision.idempotency.fingerprint_mismatch === "REJECT", "idempotency fingerprint mismatch fails closed");
assert(decision.migration_required_in_p0_7 === false, "P0-7 is a decision/specification unit without migration");
assert(decision.production_database_mutation_allowed === false, "production mutation is forbidden in P0-7");

const blockers = new Map(decision.known_blockers.map((item) => [item.code, item.severity]));
assert(blockers.get("DUAL_LEDGER_POSTING_DIVERGENCE") === "P0", "dual-ledger divergence remains an explicit P0 production blocker");
assert(blockers.get("LEGACY_RENT_POSTING_CAN_BE_UNBALANCED") === "P0", "unbalanced legacy rent posting remains an explicit P0 blocker");
assert(blockers.get("AUTHORITATIVE_SOURCE_LINK_TYPE_MISMATCH") === "P0", "source-link type mismatch remains an explicit P0 blocker");
assert(blockers.get("SALES_RPC_MISMATCH") === "P1", "sales RPC mismatch remains tracked as P1");
assert(blockers.get("INVENTORY_COSTING_POLICY_UNDECIDED") === "P1", "inventory costing decision remains tracked as P1");

function balanced(label, debits, credits) {
  const debitTotal = debits.reduce((sum, value) => sum + value, 0);
  const creditTotal = credits.reduce((sum, value) => sum + value, 0);
  assert(debitTotal > 0 && debitTotal === creditTotal, `${label} example balances (${debitTotal} = ${creditTotal})`);
}

balanced("sale with pass-through rent", [1100, 600], [1000, 600, 100]);
balanced("purchase", [900, 90], [990]);
balanced("customer payment", [500], [500]);
balanced("vendor payment", [500], [500]);
balanced("sales return", [200, 120], [200, 120]);
balanced("exact sale reversal", [1000, 600, 100], [1100, 600]);

for (const requiredText of [
  "one accounting truth",
  "LEGACY_NON_AUTHORITATIVE",
  "Posted journal lines are immutable",
  "total debits equal total credits",
  "record_sales_transaction",
  "No costing method is selected by P0-7",
  "production financial reporting is not allowed to claim completeness"
]) {
  assert(adr.includes(requiredText), `ADR contains required decision text: ${requiredText}`);
}

if (failures.length > 0) {
  console.error("\nP0_7_ACCOUNTING_DECISION_INVALID");
  for (const failure of failures) console.error(`FAIL  ${failure}`);
  process.exit(1);
}

console.log("\nP0_7_ACCOUNTING_DECISION_VALID");
console.log("AUTHORITATIVE_GL=public.journal_entries+public.journal_lines");
console.log("LEGACY_GL=NON_AUTHORITATIVE");
console.log("DOUBLE_ENTRY=MANDATORY");
console.log("POSTED_HISTORY=IMMUTABLE_REVERSAL_ONLY");
console.log("PRODUCTION_DB_MUTATION=NONE");

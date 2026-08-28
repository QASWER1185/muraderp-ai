import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_BUNDLE_SHA256 = "749201cd05b6d11f2bc6a8d17e4277921b5f76f607d20bee639253211de3123a";
const EXPECTED_PROJECT_ID = "pmsowmiivjkwtovynhje";
const EXPECTED_PHASE21_DECISION = "HISTORICAL_ONLY_DO_NOT_APPLY";
const EXPECTED_EXECUTABLE_COUNT = 29;
const EXPECTED_LIVE_COUNT = 27;
const EXPECTED_ARCHIVE_COUNT = 36;
const MIGRATION_FILE_PATTERN = /^(\d{14})_(.+)\.sql$/;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const migrationDirectory = path.join(repositoryRoot, "supabase", "migrations");
const provenanceDirectory = path.join(repositoryRoot, "supabase", "migration-provenance");
const archiveDirectory = path.join(repositoryRoot, "supabase", "migration-history", "precanonical", "sql");
const archiveManifestPath = path.join(repositoryRoot, "supabase", "migration-history", "precanonical", "manifest.json");

const evidenceRaw = await readFile(path.join(provenanceDirectory, "live-applied.json"), "utf8");
const phase21Raw = await readFile(path.join(provenanceDirectory, "phase21-disposition.json"), "utf8");
const canonicalRaw = await readFile(path.join(provenanceDirectory, "canonical-chain.json"), "utf8");
const archiveManifestRaw = await readFile(archiveManifestPath, "utf8");

const evidence = JSON.parse(evidenceRaw);
const phase21 = JSON.parse(phase21Raw);
const canonical = JSON.parse(canonicalRaw);
const archiveManifest = JSON.parse(archiveManifestRaw);
const failures = [];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitBlobSha(value) {
  const bytes = Buffer.from(value);
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

check(sha256(evidenceRaw) === EXPECTED_BUNDLE_SHA256, "Immutable P0-1 evidence fingerprint changed.");
check(evidence.source.project_id === EXPECTED_PROJECT_ID, "Unexpected Supabase project in P0-1 evidence.");
check(evidence.source.read_only_capture === true, "P0-1 evidence must remain a read-only capture.");
check(phase21.source_evidence_sha256 === EXPECTED_BUNDLE_SHA256, "Phase 21 disposition is not bound to P0-1 evidence.");
check(phase21.decision === EXPECTED_PHASE21_DECISION, "Phase 21 disposition changed.");
check(phase21.executable === false, "Phase 21 must remain non-executable.");
check(canonical.source_live_evidence_sha256 === EXPECTED_BUNDLE_SHA256, "Canonical chain is not bound to P0-1 evidence.");
check(canonical.expected_count === EXPECTED_EXECUTABLE_COUNT, "Canonical expected executable count changed.");
check(canonical.live_canonical_count === EXPECTED_LIVE_COUNT, "Canonical live count changed.");
check(canonical.clean_replay_executed === false, "This unit must not claim clean replay execution.");

const filenames = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
const active = [];
for (const filename of filenames) {
  const match = filename.match(MIGRATION_FILE_PATTERN);
  check(Boolean(match), `Invalid executable migration filename: ${filename}`);
  if (!match) continue;
  const sql = await readFile(path.join(migrationDirectory, filename), "utf8");
  active.push({ filename, version: match[1], name: match[2], sql, sql_sha256: sha256(sql), git_blob_sha: gitBlobSha(sql) });
}

check(active.length === EXPECTED_EXECUTABLE_COUNT, `Expected ${EXPECTED_EXECUTABLE_COUNT} executable migrations, found ${active.length}.`);
const versionSet = new Set(active.map((entry) => entry.version));
check(versionSet.size === active.length, "Duplicate executable migration version detected.");

const canonicalFilenames = canonical.entries.map((entry) => `${entry.version}_${entry.name}.sql`);
check(JSON.stringify(filenames) === JSON.stringify([...canonicalFilenames].sort()), "Executable directory does not exactly match canonical-chain.json.");

const activeByFilename = new Map(active.map((entry) => [entry.filename, entry]));
const liveByIdentity = new Map(evidence.live_applied_migrations.map((entry) => [`${entry.version}_${entry.name}.sql`, entry]));
check(liveByIdentity.size === EXPECTED_LIVE_COUNT, `Expected ${EXPECTED_LIVE_COUNT} unique live identities.`);

for (const [filename, live] of liveByIdentity) {
  const file = activeByFilename.get(filename);
  check(Boolean(file), `Missing exact live canonical migration: ${filename}`);
  if (!file) continue;
  const authoritativeSql = live.statements.join("\n");
  check(file.sql === authoritativeSql, `Executable SQL bytes differ from live ledger: ${filename}`);
  check(file.sql_sha256 === live.sql_sha256, `Executable SHA-256 differs from live ledger: ${filename}`);
}

for (const entry of canonical.entries) {
  const filename = `${entry.version}_${entry.name}.sql`;
  const file = activeByFilename.get(filename);
  check(Boolean(file), `Canonical entry missing: ${filename}`);
  if (!file) continue;
  if (entry.status === "LIVE-CANONICAL") {
    check(liveByIdentity.has(filename), `LIVE-CANONICAL entry is absent from live evidence: ${filename}`);
    check(file.sql_sha256 === entry.sql_sha256, `Canonical manifest SHA-256 mismatch: ${filename}`);
  } else if (entry.status === "PENDING-EXECUTABLE") {
    check(file.git_blob_sha === entry.git_blob_sha, `Pending migration changed: ${filename}`);
  } else {
    check(false, `Unsupported canonical status for ${filename}: ${entry.status}`);
  }
}

const phase21Names = new Set(phase21.files.map((entry) => entry.filename));
for (const filename of phase21Names) {
  check(!activeByFilename.has(filename), `Phase 21 historical SQL remains executable: ${filename}`);
}

check(archiveManifest.archive_is_executable === false, "Historical archive must be explicitly non-executable.");
check(archiveManifest.source_evidence_sha256 === EXPECTED_BUNDLE_SHA256, "Archive manifest is not bound to P0-1 evidence.");
check(archiveManifest.entries.length === EXPECTED_ARCHIVE_COUNT, `Expected ${EXPECTED_ARCHIVE_COUNT} archived migrations.`);
const archivedNames = (await readdir(archiveDirectory)).filter((name) => name.endsWith(".sql")).sort();
check(archivedNames.length === EXPECTED_ARCHIVE_COUNT, `Expected ${EXPECTED_ARCHIVE_COUNT} archived SQL files, found ${archivedNames.length}.`);
check(new Set(archivedNames).size === archivedNames.length, "Duplicate archive filenames detected.");

const manifestNames = archiveManifest.entries.map((entry) => entry.filename).sort();
check(JSON.stringify(archivedNames) === JSON.stringify(manifestNames), "Archive directory differs from archive manifest.");

const baselineByName = new Map(evidence.repository.baseline_files.map((entry) => [entry.filename, entry]));
for (const entry of archiveManifest.entries) {
  const archivePath = path.join(archiveDirectory, entry.filename);
  const sql = await readFile(archivePath, "utf8");
  check(sha256(sql) === entry.sql_sha256, `Archived SQL SHA-256 mismatch: ${entry.filename}`);
  check(gitBlobSha(sql) === entry.git_blob_sha, `Archived Git blob mismatch: ${entry.filename}`);
  const baseline = baselineByName.get(entry.filename);
  check(Boolean(baseline), `Archived file missing from immutable P0-1 repository baseline: ${entry.filename}`);
  if (baseline) {
    check(baseline.sql_sha256 === entry.sql_sha256, `Archived SHA differs from P0-1 baseline: ${entry.filename}`);
    check(baseline.git_blob_sha === entry.git_blob_sha, `Archived Git blob differs from P0-1 baseline: ${entry.filename}`);
  }
  check(!activeByFilename.has(entry.filename), `Historical file is still executable: ${entry.filename}`);
}

for (const entry of phase21.files) {
  const manifestEntry = archiveManifest.entries.find((candidate) => candidate.filename === entry.filename);
  check(Boolean(manifestEntry), `Phase 21 historical file missing from archive manifest: ${entry.filename}`);
  if (manifestEntry) {
    check(manifestEntry.classification === "DO-NOT-APPLY", `Phase 21 archive classification changed: ${entry.filename}`);
    check(manifestEntry.sql_sha256 === entry.sql_sha256, `Phase 21 archive SHA mismatch: ${entry.filename}`);
    check(manifestEntry.git_blob_sha === entry.git_blob_sha, `Phase 21 archive blob mismatch: ${entry.filename}`);
  }
}

const pending = canonical.entries.filter((entry) => entry.status === "PENDING-EXECUTABLE");
check(pending.length === 2, "Expected exactly two pending executable migrations.");
check(pending[0]?.version === "20260824170000", "Phase 7A must be the first pending executable migration.");
check(pending[1]?.version === "20260828182231", "P0-4 Branch Foundation must be the second pending executable migration.");
check(canonical.entries.every((entry, index, array) => index === 0 || array[index - 1].version < entry.version), "Canonical chain is not strictly chronological and unique.");

if (failures.length) {
  console.error("MIGRATION_PROVENANCE_VALIDATION_FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("MIGRATION_PROVENANCE_VALID");
console.log(JSON.stringify({
  project_id: evidence.source.project_id,
  live_canonical: EXPECTED_LIVE_COUNT,
  pending_executable: 2,
  executable_count: active.length,
  unique_versions: versionSet.size,
  archived_historical: archivedNames.length,
  phase21_disposition: phase21.decision,
  exact_live_ledger_match: true,
  clean_replay: "NOT_EXECUTED"
}, null, 2));

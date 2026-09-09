import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_BUNDLE_SHA256 =
  "749201cd05b6d11f2bc6a8d17e4277921b5f76f607d20bee639253211de3123a";
const EXPECTED_PROJECT_ID = "pmsowmiivjkwtovynhje";
const EXPECTED_PHASE21_DECISION = "HISTORICAL_ONLY_DO_NOT_APPLY";
const EXPECTED_PHASE21_SOURCE_STATE = "PENDING_P0_2_REVIEW";
const EXPECTED_EXECUTABLE_COUNT = 36;
const EXPECTED_LIVE_COUNT = 27;
const EXPECTED_ARCHIVE_COUNT = 36;
const EXPECTED_PENDING_VERSIONS = [
  "20260824170000",
  "20260828182231",
  "20260829062845",
  "20260829065058",
  "20260829173824",
  "20260831061425",
  "20260902090000",
  "20260902103000",
  "20260907120000",
];
const EXPECTED_REPLACED_IN_PLACE_ARCHIVE =
  "20260815163914_phase_20_ai_copilot_execution_audit.sql";
const EXPECTED_IDENTITY_FOUNDATION =
  "20260815070000_phase_10_identity_organization_authorization.sql";
const MIGRATION_FILE_PATTERN = /^(\d{14})_(.+)\.sql$/;
const EVIDENCE_RELATIVE_PATH =
  "supabase/migration-provenance/live-applied.json";
const PHASE21_DISPOSITION_RELATIVE_PATH =
  "supabase/migration-provenance/phase21-disposition.json";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const migrationDirectory = path.join(repositoryRoot, "supabase", "migrations");
const provenanceDirectory = path.join(repositoryRoot, "supabase", "migration-provenance");
const archiveDirectory = path.join(
  repositoryRoot,
  "supabase",
  "migration-history",
  "precanonical",
  "sql",
);
const archiveManifestPath = path.join(
  repositoryRoot,
  "supabase",
  "migration-history",
  "precanonical",
  "manifest.json",
);
const canonicalChainPath = path.join(
  provenanceDirectory,
  "canonical-chain.json",
);
const failures = [];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitBlobSha(value) {
  const bytes = Buffer.from(value);
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function normalizedSql(value) {
  return value.replace(/\r\n/g, "\n").trimEnd();
}

function migrationVersion(filename) {
  return filename.match(MIGRATION_FILE_PATTERN)?.[1] ?? null;
}

function failNow(message) {
  console.error("MIGRATION_PROVENANCE_VALIDATION_FAILED");
  console.error(`- ${message}`);
  process.exit(1);
}

function committedBlob(relativePath) {
  try {
    return execFileSync(
      "git",
      ["cat-file", "blob", `HEAD:${relativePath.replaceAll("\\", "/")}`],
      {
        cwd: repositoryRoot,
        maxBuffer: 32 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  } catch (error) {
    const stderr = error?.stderr?.toString("utf8")?.trim();
    failNow(
      `Unable to read committed Git blob ${relativePath}${stderr ? `: ${stderr}` : "."}`,
    );
  }
}

function committedBlobObject(blobSha) {
  try {
    return execFileSync("git", ["cat-file", "blob", blobSha], {
      cwd: repositoryRoot,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    const stderr = error?.stderr?.toString("utf8")?.trim();
    failNow(
      `Unable to read immutable Git blob ${blobSha}${stderr ? `: ${stderr}` : "."}`,
    );
  }
}

const evidenceBuffer = committedBlob(EVIDENCE_RELATIVE_PATH);
const phase21DispositionBuffer = committedBlob(
  PHASE21_DISPOSITION_RELATIVE_PATH,
);
const evidenceRaw = evidenceBuffer.toString("utf8");
const phase21DispositionRaw = phase21DispositionBuffer.toString("utf8");
const workingEvidenceBuffer = await readFile(
  path.join(repositoryRoot, EVIDENCE_RELATIVE_PATH),
);
const workingPhase21Buffer = await readFile(
  path.join(repositoryRoot, PHASE21_DISPOSITION_RELATIVE_PATH),
);
const canonicalRaw = await readFile(canonicalChainPath, "utf8");
const archiveManifestRaw = await readFile(archiveManifestPath, "utf8");
const evidence = JSON.parse(evidenceRaw);
const phase21Disposition = JSON.parse(phase21DispositionRaw);
const canonical = JSON.parse(canonicalRaw);
const archiveManifest = JSON.parse(archiveManifestRaw);

check(
  workingEvidenceBuffer.equals(evidenceBuffer),
  "The working-tree live migration evidence differs from its committed immutable blob.",
);
check(
  workingPhase21Buffer.equals(phase21DispositionBuffer),
  "The working-tree Phase 21 disposition differs from its committed immutable blob.",
);
check(
  sha256(evidenceBuffer) === EXPECTED_BUNDLE_SHA256,
  "The live migration evidence bundle fingerprint changed.",
);
check(evidence.schema_version === 1, "Unsupported provenance schema version.");
check(
  evidence.source.project_id === EXPECTED_PROJECT_ID,
  "The evidence bundle targets an unexpected Supabase project.",
);
check(
  evidence.source.read_only_capture === true,
  "The evidence bundle must be marked as a read-only capture.",
);

check(
  evidence.repository.phase21_active_chain.disposition ===
    EXPECTED_PHASE21_SOURCE_STATE,
  "The immutable P0-1 evidence no longer reflects its captured Phase 21 state.",
);
check(
  phase21Disposition.schema_version === 1,
  "Unsupported Phase 21 disposition schema version.",
);
check(
  phase21Disposition.decision_id === "STEP_6_P0_2_PHASE21_DISPOSITION",
  "Unexpected Phase 21 disposition decision id.",
);
check(
  phase21Disposition.source_evidence_sha256 === EXPECTED_BUNDLE_SHA256,
  "Phase 21 disposition is not bound to the approved P0-1 evidence bundle.",
);
check(
  phase21Disposition.decision === EXPECTED_PHASE21_DECISION,
  "Phase 21 disposition must keep the historical migrations non-executable.",
);
check(
  phase21Disposition.executable === false,
  "Phase 21 historical migrations must remain non-executable.",
);
check(
  phase21Disposition.replacement_required === true,
  "Phase 21 must require a canonical replacement rather than silent reuse.",
);
check(
  phase21Disposition.canonical_identity_foundation ===
    EXPECTED_IDENTITY_FOUNDATION,
  "Phase 21 disposition changed the canonical Phase 10 identity foundation.",
);
check(
  phase21Disposition.future_version_floor_exclusive ===
    evidence.reconciliation.future_version_floor_exclusive,
  "Phase 21 disposition changed the approved future migration version floor.",
);
check(
  phase21Disposition.runtime_compatibility?.null_branch_semantics ===
    "DEPRECATED_FOR_TENANT_ISOLATION_FOUNDATION",
  "Phase 21 null-branch wildcard semantics must remain deprecated for the tenant isolation foundation.",
);

const liveVersions = new Set();
for (const migration of evidence.live_applied_migrations) {
  check(
    MIGRATION_FILE_PATTERN.test(`${migration.version}_${migration.name}.sql`),
    `Invalid live migration identity: ${migration.version}_${migration.name}`,
  );
  check(
    !liveVersions.has(migration.version),
    `Duplicate live migration version: ${migration.version}`,
  );
  liveVersions.add(migration.version);

  const sql = migration.statements.join("\n");
  check(
    sha256(sql) === migration.sql_sha256,
    `Live SQL fingerprint mismatch: ${migration.version}_${migration.name}`,
  );
}

check(
  evidence.live_applied_migrations.length ===
    evidence.reconciliation.live_applied_count,
  "Live migration count does not match the reconciliation metadata.",
);

const activeFilenames = (await readdir(migrationDirectory))
  .filter((filename) => filename.endsWith(".sql"))
  .sort();
const activeRows = [];

for (const filename of activeFilenames) {
  const match = filename.match(MIGRATION_FILE_PATTERN);
  check(Boolean(match), `Invalid active migration filename: ${filename}`);
  if (!match) {
    continue;
  }
  const buffer = await readFile(path.join(migrationDirectory, filename));
  const sql = buffer.toString("utf8");
  activeRows.push({
    filename,
    version: match[1],
    sql,
    sql_sha256: sha256(buffer),
    git_blob_sha: gitBlobSha(buffer),
  });
}

const baselineByName = new Map(
  evidence.repository.baseline_files.map((entry) => [entry.filename, entry]),
);
const activeByName = new Map(activeRows.map((entry) => [entry.filename, entry]));
const activeByVersion = new Map();
for (const active of activeRows) {
  const rows = activeByVersion.get(active.version) ?? [];
  rows.push(active);
  activeByVersion.set(active.version, rows);
}
check(
  activeRows.length === EXPECTED_EXECUTABLE_COUNT,
  "Executable migration count is not the approved canonical count.",
);
check(
  new Set(activeRows.map((entry) => entry.version)).size === activeRows.length,
  "Duplicate executable migration version detected.",
);

const archivedNames = (await readdir(archiveDirectory))
  .filter((filename) => filename.endsWith(".sql"))
  .sort();
const archiveByName = new Map(
  archiveManifest.entries.map((entry) => [entry.filename, entry]),
);
check(
  archiveManifest.schema_version === 1,
  "Unsupported precanonical archive manifest schema version.",
);
check(
  archiveManifest.archive_is_executable === false,
  "Historical archive must remain explicitly non-executable.",
);
check(
  archiveManifest.source_evidence_sha256 === EXPECTED_BUNDLE_SHA256,
  "Archive manifest is not bound to the immutable P0-1 evidence bundle.",
);
check(
  archiveManifest.entries.length === EXPECTED_ARCHIVE_COUNT,
  "Archived migration manifest count changed.",
);
check(
  archivedNames.length === EXPECTED_ARCHIVE_COUNT,
  "Archived migration SQL count changed.",
);
check(
  new Set(archivedNames).size === archivedNames.length,
  "Duplicate archived migration filenames detected.",
);
check(
  new Set(archiveManifest.entries.map((entry) => entry.filename)).size ===
    archiveManifest.entries.length,
  "Archive manifest contains duplicate filenames.",
);
check(
  JSON.stringify(archivedNames) ===
    JSON.stringify(archiveManifest.entries.map((entry) => entry.filename).sort()),
  "Archive directory differs from its manifest.",
);

for (const baseline of evidence.repository.baseline_files) {
  const committed = committedBlobObject(baseline.git_blob_sha);
  check(
    sha256(committed) === baseline.sql_sha256,
    "Committed baseline SQL fingerprint changed: " + baseline.filename,
  );
  check(
    gitBlobSha(committed) === baseline.git_blob_sha,
    "Committed baseline Git blob changed: " + baseline.filename,
  );
  const active = activeByName.get(baseline.filename);
  const archived = archiveByName.get(baseline.filename);
  if (active) {
    if (active.sql_sha256 === baseline.sql_sha256) {
      check(
        active.git_blob_sha === baseline.git_blob_sha,
        "Active baseline Git blob changed: " + baseline.filename,
      );
    } else {
      check(
        baseline.filename === EXPECTED_REPLACED_IN_PLACE_ARCHIVE,
        "Baseline SQL changed without an approved in-place canonical replacement: " +
          baseline.filename,
      );
      check(
        Boolean(archived),
        "Changed in-place baseline is not preserved in the archive: " +
          baseline.filename,
      );
    }
  } else {
    check(
      Boolean(archived),
      "Historical baseline is neither active nor archived: " + baseline.filename,
    );
  }
  if (archived) {
    const archivePath = path.join(archiveDirectory, archived.filename);
    const archiveBuffer = await readFile(archivePath);
    check(
      sha256(archiveBuffer) === archived.sql_sha256,
      "Archived SQL SHA-256 mismatch: " + archived.filename,
    );
    check(
      gitBlobSha(archiveBuffer) === archived.git_blob_sha,
      "Archived Git blob mismatch: " + archived.filename,
    );
    check(
      archived.sql_sha256 === baseline.sql_sha256,
      "Archived SQL differs from immutable baseline: " + archived.filename,
    );
    check(
      archived.git_blob_sha === baseline.git_blob_sha,
      "Archived Git blob differs from immutable baseline: " + archived.filename,
    );
  }
}

for (const archived of archiveManifest.entries) {
  const active = activeByName.get(archived.filename);
  if (!active) continue;
  check(
    archived.filename === EXPECTED_REPLACED_IN_PLACE_ARCHIVE,
    "Historical archive file remains executable: " + archived.filename,
  );
  check(
    active.sql_sha256 !== archived.sql_sha256,
    "In-place canonical replacement did not change SQL bytes: " +
      archived.filename,
  );
}

const liveByVersion = new Map(
  evidence.live_applied_migrations.map((entry) => [entry.version, entry]),
);
const liveByIdentity = new Map(
  evidence.live_applied_migrations.map((entry) => [
    entry.version + "_" + entry.name + ".sql",
    entry,
  ]),
);

for (const live of evidence.live_applied_migrations) {
  const filename = live.version + "_" + live.name + ".sql";
  const active = activeByName.get(filename);
  check(
    Boolean(active),
    "Missing exact live canonical migration: " + filename,
  );
  if (active) {
    const authoritativeSql = live.statements.join("\n");
    check(
      active.sql === authoritativeSql,
      "Executable SQL bytes differ from live ledger: " + filename,
    );
    check(
      active.sql_sha256 === live.sql_sha256,
      "Executable SHA-256 differs from live ledger: " + filename,
    );
  }
}

for (const active of activeRows) {
  const live = liveByVersion.get(active.version);
  if (live) {
    const identity = live.version + "_" + live.name + ".sql";
    check(
      active.filename === identity,
      "Executable migration reuses a live version under a different identity: " +
        active.filename,
    );
    check(
      active.sql === live.statements.join("\n"),
      "Executable migration would replay different SQL for live version: " +
        active.filename,
    );
  } else {
    check(
      active.version ===
        evidence.reconciliation.future_version_floor_exclusive ||
        active.version >
          evidence.reconciliation.future_version_floor_exclusive,
      "New migration must use a version greater than " +
        evidence.reconciliation.future_version_floor_exclusive +
        ": " +
        active.filename,
    );
  }
}

const historicalDuplicateFilenames = evidence.repository.known_duplicate_versions
  .flatMap((entry) => entry.filenames);
for (const filename of historicalDuplicateFilenames) {
  check(
    !activeByName.has(filename),
    "Historical duplicate remains executable: " + filename,
  );
  check(
    archiveByName.has(filename),
    "Historical duplicate is missing from the archive: " + filename,
  );
}

for (const [version, rows] of activeByVersion) {
  check(
    rows.length === 1,
    "Executable version collision remains after canonicalization: " + version,
  );
}

const expectedPhase21Files = [
  ...evidence.repository.phase21_active_chain.files,
].sort();
const dispositionPhase21Files = phase21Disposition.files
  .map((entry) => entry.filename)
  .sort();
check(
  JSON.stringify(dispositionPhase21Files) === JSON.stringify(expectedPhase21Files),
  "Phase 21 disposition file set differs from the P0-1 evidence bundle.",
);
check(
  new Set(dispositionPhase21Files).size === dispositionPhase21Files.length,
  "Phase 21 disposition contains duplicate filenames.",
);

for (const entry of phase21Disposition.files) {
  const baseline = baselineByName.get(entry.filename);
  const archived = archiveByName.get(entry.filename);
  const active = activeByName.get(entry.filename);
  check(Boolean(baseline), "Phase 21 baseline file is unknown: " + entry.filename);
  check(Boolean(archived), "Phase 21 historical file is missing from archive: " + entry.filename);
  check(!active, "Phase 21 historical SQL remains executable: " + entry.filename);
  check(entry.do_not_apply === true, "Phase 21 file is not blocked: " + entry.filename);
  check(
    typeof entry.disposition === "string" && entry.disposition.length > 0,
    "Phase 21 file has no disposition: " + entry.filename,
  );
  if (baseline && archived) {
    check(
      entry.sql_sha256 === baseline.sql_sha256 &&
        archived.sql_sha256 === baseline.sql_sha256,
      "Phase 21 SQL fingerprint changed: " + entry.filename,
    );
    check(
      entry.git_blob_sha === baseline.git_blob_sha &&
        archived.git_blob_sha === baseline.git_blob_sha,
      "Phase 21 Git blob fingerprint changed: " + entry.filename,
    );
    check(
      archived.classification === "DO-NOT-APPLY",
      "Phase 21 archive classification changed: " + entry.filename,
    );
  }
}

check(
  canonical.schema_version === 1,
  "Unsupported canonical-chain schema version.",
);
check(
  canonical.decision_id ===
    "STEP_6_P0_1R_EXACT_LIVE_LEDGER_CANONICALIZATION",
  "Canonical-chain decision id changed.",
);
check(
  canonical.source_live_evidence_sha256 === EXPECTED_BUNDLE_SHA256,
  "Canonical chain is not bound to the immutable P0-1 evidence bundle.",
);
check(
  canonical.expected_count === EXPECTED_EXECUTABLE_COUNT,
  "Canonical expected executable count changed.",
);
check(
  canonical.live_canonical_count === EXPECTED_LIVE_COUNT,
  "Canonical live count changed.",
);
check(
  canonical.pending_executable_count === EXPECTED_PENDING_VERSIONS.length,
  "Canonical pending count changed.",
);
check(
  canonical.active_chain_deployable === true,
  "Canonical chain is not marked deployable after reconciliation.",
);
check(
  canonical.clean_replay_executed === false,
  "Canonical chain must not claim a replay was executed.",
);

const canonicalFilenames = canonical.entries
  .map((entry) => entry.version + "_" + entry.name + ".sql")
  .sort();
check(
  JSON.stringify(activeFilenames) === JSON.stringify(canonicalFilenames),
  "Executable directory does not exactly match canonical-chain.json.",
);
check(
  canonical.entries.length === EXPECTED_EXECUTABLE_COUNT,
  "Canonical entry count changed.",
);
const canonicalVersions = canonical.entries.map((entry) => entry.version);
check(
  new Set(canonicalVersions).size === canonicalVersions.length,
  "Canonical chain contains duplicate version identities.",
);
check(
  canonical.entries.every(
    (entry, index, entries) =>
      index === 0 || entries[index - 1].version < entry.version,
  ),
  "Canonical chain is not strictly chronological and unique.",
);

for (const entry of canonical.entries) {
  const filename = entry.version + "_" + entry.name + ".sql";
  const active = activeByName.get(filename);
  check(Boolean(active), "Canonical entry missing: " + filename);
  if (!active) continue;
  if (entry.status === "LIVE-CANONICAL") {
    check(
      liveByIdentity.has(filename),
      "LIVE-CANONICAL entry is absent from live evidence: " + filename,
    );
    check(
      active.sql_sha256 === entry.sql_sha256,
      "Canonical live SQL fingerprint mismatch: " + filename,
    );
  } else if (entry.status === "PENDING-EXECUTABLE") {
    check(
      !liveByVersion.has(entry.version),
      "Pending migration reuses an already-live version: " + filename,
    );
    check(
      entry.version ===
        evidence.reconciliation.future_version_floor_exclusive ||
        entry.version >
          evidence.reconciliation.future_version_floor_exclusive,
      "Pending migration is not above the approved floor: " + filename,
    );
    check(
      active.git_blob_sha === entry.git_blob_sha,
      "Pending migration changed: " + filename,
    );
  } else {
    check(false, "Unsupported canonical status for " + filename + ": " + entry.status);
  }
}

const pendingEntries = canonical.entries.filter(
  (entry) => entry.status === "PENDING-EXECUTABLE",
);
check(
  pendingEntries.length === EXPECTED_PENDING_VERSIONS.length,
  "Expected exactly the approved pending executable migrations.",
);
check(
  JSON.stringify(pendingEntries.map((entry) => entry.version)) ===
    JSON.stringify(EXPECTED_PENDING_VERSIONS),
  "Pending executable migration ordering changed.",
);
check(
  evidence.repository.phase21_active_chain.executable === false,
  "The P0-1 evidence must record Phase 21 as non-executable.",
);
check(
  evidence.reconciliation.active_chain_blockers.includes(
    "P0_2_PHASE21_DISPOSITION_REQUIRED",
  ),
  "The immutable P0-1 evidence no longer records the original P0-2 blocker.",
);
const historicalBlockers = evidence.reconciliation.active_chain_blockers;
check(
  historicalBlockers.includes("REMOTE_AND_REPOSITORY_VERSION_SETS_DIVERGE"),
  "The immutable P0-1 evidence no longer records the original version-set divergence.",
);
check(
  historicalBlockers.includes("HISTORICAL_DUPLICATE_REPOSITORY_VERSIONS"),
  "The immutable P0-1 evidence no longer records the original duplicate-version blocker.",
);
const remainingActiveChainBlockers = [];

if (failures.length > 0) {
  console.error("MIGRATION_PROVENANCE_VALIDATION_FAILED");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("MIGRATION_PROVENANCE_VALID");
console.log(
  JSON.stringify(
    {
      project_id: evidence.source.project_id,
      live_applied: evidence.live_applied_migrations.length,
      repository_baseline_files: evidence.repository.baseline_files.length,
      active_files: activeRows.length,
      active_duplicate_versions: 0,
      archived_duplicate_versions:
        evidence.repository.known_duplicate_versions.length,
      phase21_disposition: phase21Disposition.decision,
      p0_2_resolved: true,
      active_chain_deployable: true,
      remaining_active_chain_blockers: remainingActiveChainBlockers,
      future_version_floor_exclusive:
        evidence.reconciliation.future_version_floor_exclusive,
      integrity_source: "COMMITTED_GIT_BLOBS",
    },
    null,
    2,
  ),
);

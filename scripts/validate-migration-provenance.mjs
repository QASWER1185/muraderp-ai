import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_BUNDLE_SHA256 =
  "749201cd05b6d11f2bc6a8d17e4277921b5f76f607d20bee639253211de3123a";
const EXPECTED_PROJECT_ID = "pmsowmiivjkwtovynhje";
const MIGRATION_FILE_PATTERN = /^(\d{14})_(.+)\.sql$/;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const migrationDirectory = path.join(repositoryRoot, "supabase", "migrations");
const evidencePath = path.join(
  repositoryRoot,
  "supabase",
  "migration-provenance",
  "live-applied.json",
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

const evidenceRaw = await readFile(evidencePath, "utf8");
const evidence = JSON.parse(evidenceRaw);

check(
  sha256(evidenceRaw) === EXPECTED_BUNDLE_SHA256,
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
  const sql = await readFile(path.join(migrationDirectory, filename), "utf8");
  activeRows.push({
    filename,
    version: match[1],
    sql,
    sql_sha256: sha256(sql),
    git_blob_sha: gitBlobSha(sql),
  });
}

const baselineByName = new Map(
  evidence.repository.baseline_files.map((entry) => [entry.filename, entry]),
);
const activeByName = new Map(activeRows.map((entry) => [entry.filename, entry]));

for (const baseline of evidence.repository.baseline_files) {
  const active = activeByName.get(baseline.filename);
  check(Boolean(active), `Historical migration is missing: ${baseline.filename}`);
  if (active) {
    check(
      active.sql_sha256 === baseline.sql_sha256,
      `Historical migration was modified: ${baseline.filename}`,
    );
    check(
      active.git_blob_sha === baseline.git_blob_sha,
      `Historical migration Git blob changed: ${baseline.filename}`,
    );
  }
}

for (const active of activeRows) {
  if (baselineByName.has(active.filename)) {
    continue;
  }
  check(
    active.version > evidence.reconciliation.future_version_floor_exclusive,
    `New migration must use a version greater than ${evidence.reconciliation.future_version_floor_exclusive}: ${active.filename}`,
  );
  check(
    !liveVersions.has(active.version),
    `New migration reuses an already-live version: ${active.filename}`,
  );
}

const duplicateVersions = new Map();
for (const active of activeRows) {
  const filenames = duplicateVersions.get(active.version) ?? [];
  filenames.push(active.filename);
  duplicateVersions.set(active.version, filenames);
}

const actualDuplicates = [...duplicateVersions.entries()]
  .filter(([, filenames]) => filenames.length > 1)
  .map(([version, filenames]) => ({ version, filenames: filenames.sort() }))
  .sort((left, right) => left.version.localeCompare(right.version));
const expectedDuplicates = evidence.repository.known_duplicate_versions.map(
  (entry) => ({
    version: entry.version,
    filenames: [...entry.filenames].sort(),
  }),
);

check(
  JSON.stringify(actualDuplicates) === JSON.stringify(expectedDuplicates),
  "The active migration version collisions differ from the acknowledged historical set.",
);

const liveByVersion = new Map(
  evidence.live_applied_migrations.map((entry) => [entry.version, entry]),
);
for (const active of activeRows) {
  const live = liveByVersion.get(active.version);
  if (!live) {
    continue;
  }
  const isExact = normalizedSql(active.sql) === normalizedSql(live.statements.join("\n"));
  check(
    (live.repository_relation === "EXACT_ACTIVE_VERSION_AND_SQL") === isExact,
    `Live/repository relation changed for version ${active.version}.`,
  );
}

for (const version of evidence.reconciliation.archive_only_live_versions) {
  check(
    !activeRows.some((entry) => entry.version === version),
    `Archive-only live migration was placed in the executable chain: ${version}`,
  );
}

for (const filename of evidence.repository.phase21_active_chain.files) {
  check(
    activeByName.has(filename),
    `Phase 21 evidence file is missing before P0-2 disposition: ${filename}`,
  );
}
check(
  evidence.repository.phase21_active_chain.executable === false,
  "Phase 21 must remain non-executable pending P0-2.",
);
check(
  evidence.reconciliation.active_chain_deployable === false,
  "The active chain must remain blocked until the documented blockers are resolved.",
);

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
      acknowledged_duplicate_versions: actualDuplicates.length,
      phase21_disposition: evidence.repository.phase21_active_chain.disposition,
      active_chain_deployable: evidence.reconciliation.active_chain_deployable,
      future_version_floor_exclusive:
        evidence.reconciliation.future_version_floor_exclusive,
    },
    null,
    2,
  ),
);

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const requiredPaths = [
  "backend/package.json",
  "backend/tsconfig.build.json",
  ".github/workflows/backend-ci.yml",
  ".github/workflows/phase23-closure.yml",
  ".github/workflows/production-security-gate.yml",
  "supabase",
  "supabase/data-ownership/p0-3-existing-data-classification.json",
  "scripts/validate-existing-data-ownership.mjs",
  "scripts/validate-p0-5-authorization-foundation.mjs",
  "scripts/validate-p0-6-service-principal-foundation.mjs",
];

const failures = [];
const pass = (message) => console.log(`PASS  ${message}`);
const fail = (message) => failures.push(message);

for (const relativePath of requiredPaths) {
  if (existsSync(resolve(root, relativePath))) pass(`required release asset exists: ${relativePath}`);
  else fail(`missing required release asset: ${relativePath}`);
}

const packageJson = JSON.parse(readFileSync(resolve(root, "backend/package.json"), "utf8"));
for (const script of ["typecheck", "test", "build", "check", "start"]) {
  if (typeof packageJson.scripts?.[script] === "string") pass(`backend npm script exists: ${script}`);
  else fail(`backend npm script missing: ${script}`);
}

const serverSource = readFileSync(resolve(root, "backend/src/server.ts"), "utf8");
const appSource = readFileSync(resolve(root, "backend/src/app.ts"), "utf8");
if (serverSource.includes("server.listen(env.PORT")) pass("server uses validated configured port");
else fail("server does not use the validated configured port");
if (appSource.includes("/api/v1/health") && appSource.includes("/api/health")) pass("health endpoints are registered");
else fail("health endpoints are not registered");

let trackedFiles = "";
try { trackedFiles = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }); }
catch { fail("git ls-files could not be executed"); }
for (const forbidden of [".env", ".env.local", ".env.production", ".env.development"]) {
  const tracked = trackedFiles.split("\n").some((file) => file === forbidden || file.endsWith(`/${forbidden}`));
  if (!tracked) pass(`environment secret file is not tracked: ${forbidden}`);
  else fail(`environment secret file is tracked: ${forbidden}`);
}

const sourceFiles = execFileSync("git", ["ls-files", "*.ts", "*.mjs", "*.js"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const forbiddenSecretPatterns = [/sb_secret_[A-Za-z0-9_-]{20,}/, /service_role[A-Za-z0-9_-]{10,}/];
for (const file of sourceFiles) {
  const content = readFileSync(resolve(root, file), "utf8");
  for (const pattern of forbiddenSecretPatterns) if (pattern.test(content)) fail(`possible production secret pattern found in source: ${file}`);
}
if (!failures.some((message) => message.includes("possible production secret pattern"))) pass("no production secret pattern detected in tracked source");

for (const validation of [
  ["P0-3 existing-data ownership gate", "scripts/validate-existing-data-ownership.mjs"],
  ["P0-5 membership / branch access foundation", "scripts/validate-p0-5-authorization-foundation.mjs"],
  ["P0-6 service-principal security foundation", "scripts/validate-p0-6-service-principal-foundation.mjs"],
]) {
  try {
    execFileSync(process.execPath, [resolve(root, validation[1])], { cwd: root, encoding: "utf8", stdio: "pipe" });
    pass(`${validation[0]} is valid`);
  } catch (error) {
    const detail = error?.stderr?.toString?.().trim();
    fail(`${validation[0]} failed${detail ? `: ${detail}` : ""}`);
  }
}

if (failures.length > 0) {
  console.error("\nStage 11 release readiness FAILED:");
  for (const failure of failures) console.error(`FAIL  ${failure}`);
  process.exit(1);
}
console.log("\nStage 11 release readiness checks PASSED.");

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const files = readdirSync(root).filter((file) => file.endsWith(".js") && !file.endsWith(".test.js"));
for (const file of files) {
  execFileSync(process.execPath, ["--check", resolve(root, file)], { stdio: "inherit" });
}
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.webmanifest"), "utf8"));
if (manifest.display !== "standalone" || manifest.start_url !== "/") throw new Error("Invalid production PWA manifest");
console.log(`Frontend production syntax gate PASS: ${files.length} JavaScript modules validated.`);

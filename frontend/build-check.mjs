import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const required = ["index.html","app.js","auth.js","copilot-api.js","copilot-ui.js","estimate-conversion.js","customer-api.js","customers.js","vendor-api.js","vendors.js","ai-experience.js","offline-store.js","offline-sync.js","styles.css","sw.js","manifest.webmanifest"];
for (const file of required) {
  const path = resolve(root, file);
  if (!existsSync(path)) throw new Error(`Missing production asset: ${file}`);
  if (!readFileSync(path, "utf8").trim()) throw new Error(`Empty production asset: ${file}`);
}
const html = readFileSync(resolve(root, "index.html"), "utf8");
for (const marker of ["/styles.css","/app.js","/manifest.webmanifest"]) if (!html.includes(marker)) throw new Error(`index.html missing production reference: ${marker}`);
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.webmanifest"), "utf8"));
if (manifest.display !== "standalone") throw new Error("PWA manifest must use standalone display");
const sw = readFileSync(resolve(root, "sw.js"), "utf8");
if (!sw.includes("/index.html") || !sw.includes("/app.js")) throw new Error("Service worker shell is incomplete");
const dist = resolve(root, "dist");
mkdirSync(dist, { recursive: true });
for (const file of required) writeFileSync(resolve(dist, file), readFileSync(resolve(root, file)));
writeFileSync(resolve(dist, "BUILD-MANIFEST.json"), JSON.stringify({name:"MuradERP-AI",productionGate:"PASS",assets:required}, null, 2));
console.log(`Frontend production build PASS: ${required.length} assets validated and staged in dist/.`);

import {readFileSync,writeFileSync} from "node:fs";
const file="/app/backend/dist/ai-copilot/tools/registry.js";
const source=readFileSync(file,"utf8");
const schema=/((?:["']?erp_log_expense["']?)\s*:\s*z\.strictObject\([^\n]*?kind\s*:\s*z\.enum\(\[\s*["']expense["']\s*,\s*["']salary["'])\s*\]/g;
const patched=source.replace(schema,'$1, "drawings"]');
if(patched===source) throw new Error("Preserved expense schema was not found");
writeFileSync(file,patched);

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Resolve from the module location so npm --prefix, src and dist behave alike.
 * Shell variables win; local files override base files. Never log file values.
 */
export function loadEnvironmentFiles(directory = backendRoot, target: NodeJS.ProcessEnv = process.env): void {
  const root = resolve(directory, "..");
  const values: Record<string, string> = {};
  for (const file of [resolve(root, ".env"), resolve(directory, ".env"), resolve(root, ".env.local"), resolve(directory, ".env.local")]) {
    try { Object.assign(values, parseEnv(readFileSync(file, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Could not read environment file: ${file}`);
    }
  }
  for (const [name, value] of Object.entries(values)) {
    if (target[name] === undefined) target[name] = value;
  }
}

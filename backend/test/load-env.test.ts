import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnvironmentFiles } from "../src/config/load-env.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("project environment loading", () => {
  it("loads the monorepo root without depending on the current working directory", () => {
    const root = mkdtempSync(join(tmpdir(), "muraderp-env-")); roots.push(root);
    const backend = join(root, "backend"); mkdirSync(backend);
    writeFileSync(join(root, ".env"), 'INTERNAL_API_TOKEN="test-root-token"\nBASE_ONLY=from-root\nMODEL=base\n');
    writeFileSync(join(backend, ".env"), "MODEL=backend\n");
    writeFileSync(join(root, ".env.local"), 'MODEL="local-model"\nLOCAL_ONLY=yes\n');
    const target: NodeJS.ProcessEnv = {};
    loadEnvironmentFiles(backend, target);
    expect(target).toEqual({ INTERNAL_API_TOKEN: "test-root-token", BASE_ONLY: "from-root", MODEL: "local-model", LOCAL_ONLY: "yes" });
  });
  it("preserves shell variables and gives backend .env.local final file priority", () => {
    const root = mkdtempSync(join(tmpdir(), "muraderp-env-")); roots.push(root);
    const backend = join(root, "backend"); mkdirSync(backend);
    writeFileSync(join(root, ".env.local"), "MODEL=root-local\nPORT=3002\n");
    writeFileSync(join(backend, ".env.local"), "MODEL=backend-local\nPORT=3003\n");
    const target: NodeJS.ProcessEnv = { PORT: "8080" };
    loadEnvironmentFiles(backend, target);
    expect(target).toEqual({ PORT: "8080", MODEL: "backend-local" });
  });
  it("permits missing environment files", () => {
    const root = mkdtempSync(join(tmpdir(), "muraderp-env-")); roots.push(root);
    const target: NodeJS.ProcessEnv = { PORT: "8080" };
    expect(() => loadEnvironmentFiles(join(root, "backend"), target)).not.toThrow();
    expect(target).toEqual({ PORT: "8080" });
  });
});

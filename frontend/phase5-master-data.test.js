import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("./manifest.webmanifest", import.meta.url), "utf8"));

describe("Phase 5 frontend production readiness", () => {
  const resources = ["Customers", "Vendors", "Products", "Warehouses"];

  it("exposes all Phase 5 master-data navigation surfaces", () => {
    for (const resource of resources) expect(app).toContain(`"${resource.toLowerCase()}"`);
  });

  it("uses the authoritative backend boundary for ERP actions", () => {
    expect(html).toContain("Final financial/inventory posting remains server-authoritative");
    expect(app).toContain("/api/v1/");
  });

  it("keeps authentication behind a server session boundary", () => {
    const auth = readFileSync(new URL("./auth.js", import.meta.url), "utf8");
    expect(auth).toContain("/api/v1/auth/session");
    expect(auth).toContain("credentials: \"include\"");
  });

  it("has mobile responsive layout", () => {
    expect(css).toContain("@media(max-width:720px)");
    expect(css).toContain("menu-open");
  });

  it("has a standalone PWA manifest with production icons", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it("has offline shell and synchronization support", () => {
    const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
    const sync = readFileSync(new URL("./offline-sync.js", import.meta.url), "utf8");
    expect(sw).toContain("/index.html");
    expect(sync).toContain("flushOfflineQueue");
    expect(sync).toContain("retryable");
  });
});

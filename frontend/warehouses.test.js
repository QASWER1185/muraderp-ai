import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateWarehouseDraft, warehouseRowsMarkup } from "./warehouses.js";

describe("Warehouse page", () => {
  it("validates the warehouse draft", () => { expect(validateWarehouseDraft({ name: " Main ", location: " " })).toEqual({ name: "Main", location: null }); expect(() => validateWarehouseDraft({ name: "" })).toThrow(); });
  it("escapes live warehouse data", () => { expect(warehouseRowsMarkup([{ id: 5, name: "<script>", location: "A&B" }])).toContain("&lt;script&gt;"); expect(warehouseRowsMarkup([{ id: 5, name: "Main", location: "A&B" }])).toContain("A&amp;B"); });
  it("uses central context without an organization or branch form", () => { const source = readFileSync(new URL("./warehouses.js", import.meta.url), "utf8"); expect(source).toContain("getWorkspaceContext("); expect(source).not.toContain('name="organization"'); expect(source).not.toContain('name="branch"'); });
});

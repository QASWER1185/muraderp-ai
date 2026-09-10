import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { vendorErrorMessage, vendorRowsMarkup, validateVendorDraft } from "./vendors.js";

describe("vendor production workflow", () => {
  it("normalizes valid manual input and preserves all required fields", () => {
    expect(validateVendorDraft({ name: "  Bestway Cement  ", phone: " 03007654321 ", city: " Lahore " })).toEqual({
      name: "Bestway Cement",
      phone: "03007654321",
      city: "Lahore",
    });
  });

  it("rejects incomplete or oversized input before calling the backend", () => {
    expect(() => validateVendorDraft({ name: " ", phone: "1", city: "Lahore" })).toThrow("Vendor name is required");
    expect(() => validateVendorDraft({ name: "Bestway", phone: "1".repeat(51), city: "Lahore" })).toThrow("50 characters or fewer");
  });

  it("escapes vendor data rendered into the table", () => {
    const markup = vendorRowsMarkup([{ id: 7, name: "<script>alert(1)</script>", phone: "0300&123", city: '"Lahore"', updated_at: "2026-09-10T00:00:00.000Z" }]);
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("0300&amp;123");
    expect(markup).toContain("&quot;Lahore&quot;");
  });

  it("presents distinct authentication, permission, and server validation states", () => {
    expect(vendorErrorMessage({ status: 401 })).toContain("Sign in");
    expect(vendorErrorMessage({ status: 403 })).toContain("do not have permission");
    expect(vendorErrorMessage(new Error("Vendor name is invalid"))).toBe("Vendor name is invalid");
  });

  it("mounts Vendors instead of the generic placeholder and preserves form input on server errors", () => {
    const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
    const workflow = readFileSync(new URL("./vendors.js", import.meta.url), "utf8");
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
    expect(app).toContain('id==="vendors")mountVendors(content)');
    expect(app).toContain('resetDraft();navigate("dashboard")');
    expect(workflow).toContain("formResult.textContent = vendorErrorMessage(error)");
    expect(workflow).not.toContain("catch (error) {\n      form.reset()");
    expect(css).toContain(".vendor-context-form");
    expect(css).toContain("@media(max-width:720px)");
    expect(sw).toContain('\"/vendors.js\"');
    expect(sw).toContain('\"/vendor-api.js\"');
  });
});

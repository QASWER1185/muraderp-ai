import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { customerErrorMessage, customerRowsMarkup, validateCustomerDraft } from "./customers.js";

describe("customer production workflow", () => {
  it("normalizes valid manual input and preserves all required fields", () => {
    expect(validateCustomerDraft({ name: "  Ali Raza  ", phone: " 03001234567 ", city: " Lahore " })).toEqual({
      name: "Ali Raza",
      phone: "03001234567",
      city: "Lahore",
    });
  });

  it("rejects incomplete or oversized input before calling the backend", () => {
    expect(() => validateCustomerDraft({ name: " ", phone: "1", city: "Lahore" })).toThrow("Customer name is required");
    expect(() => validateCustomerDraft({ name: "Ali", phone: "1".repeat(51), city: "Lahore" })).toThrow("50 characters or fewer");
  });

  it("escapes customer data rendered into the table", () => {
    const markup = customerRowsMarkup([{ id: 7, name: "<script>alert(1)</script>", phone: "0300&123", city: '"Lahore"', updated_at: "2026-09-10T00:00:00.000Z" }]);
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("0300&amp;123");
    expect(markup).toContain("&quot;Lahore&quot;");
  });

  it("presents distinct authentication and permission states", () => {
    expect(customerErrorMessage({ status: 401 })).toContain("Sign in");
    expect(customerErrorMessage({ status: 403 })).toContain("do not have permission");
  });

  it("mounts Customers instead of the generic placeholder and includes responsive styles", () => {
    const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
    expect(app).toContain('id==="customers")mountCustomers(content)');
    expect(app).toContain('resetDraft();navigate("dashboard")');
    expect(css).toContain(".customer-context-form");
    expect(css).toContain("@media(max-width:720px)");
    expect(sw).toContain('"/customers.js"');
    expect(sw).toContain('"/customer-api.js"');
  });
});

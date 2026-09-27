import { describe, expect, it } from "vitest";
import { dashboardMarkup } from "./dashboard.js";

describe("final dashboard markup", () => {
  it("includes the approved business identity and dashboard hierarchy", () => {
    const markup = dashboardMarkup();
    for (const text of ["MURAD BUILDING MATERIALS STORE", "0308 6235608", "Total Sales", "Total Estimates", "Receivables", "Inventory Items", "Today's Profit", "Stock Overview", "Low Stock Items", "Sales Trend", "Recent Activity", "Quick Actions", "Your business copilot"]) {
      expect(markup).toContain(text);
    }
  });

  it("does not present invented money values in the landing markup", () => {
    expect(dashboardMarkup()).not.toMatch(/PKR\s*[0-9]/);
  });
});

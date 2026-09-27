import { describe, expect, it } from "vitest";
import { dashboardMarkup } from "./dashboard.js";

describe("dashboard command center", () => {
  it("keeps the approved business identity and compact hierarchy", () => {
    const markup = dashboardMarkup();
    for (const text of ["MURAD BUILDING MATERIALS STORE", "0308 6235608", "Total Sales", "Total Estimates", "Receivables", "Inventory Items", "Today's Profit", "Sales Overview", "Inventory Health", "Sales Trend", "Recent Activity", "Quick Actions", "Your business copilot"]) {
      expect(markup).toContain(text);
    }
    expect(markup).toContain('id="dashboard-workspace-note"');
    expect(markup).not.toContain("Low Stock Items");
    expect((markup.match(/<(?:article|button) class="command-metric/g) ?? [])).toHaveLength(5);
  });

  it("does not present invented money values in the landing markup", () => {
    expect(dashboardMarkup()).not.toMatch(/PKR\s*[0-9]/);
  });
});

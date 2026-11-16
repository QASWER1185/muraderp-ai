// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportPeriod } from "./report-period.js";
import { mountReports } from "./reports.js";
import { dashboardMarkup, mountDashboard } from "./dashboard.js";
import { operationsMarkup, operationsCsv } from "./operations-reports.js";
import { invoiceListMarkup } from "./invoices.js";
import { purchaseListMarkup } from "./purchases.js";
import { stockMovementsMarkup } from "./stock.js";
const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
const empty = { sales: { daily: [], weekly: [], monthly: [], totals: {} }, products: [{ id: 231, name: "Pipe", unit: "length" }], profit: { rows: [], totals: {}, reconciliation: { revenueVariance: "0", cogsVariance: "0" } }, footnote: "Posted invoices minus posted returns", currency: "PKR", stockScope: "Selected branch stock movements" };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
describe("period reporting controls", () => {
  it("uses Karachi dates and Monday week starts across month and year boundaries", () => {
    expect(reportPeriod("daily", new Date("2026-11-15T20:00:00Z"))).toEqual({ from: "2026-11-16", to: "2026-11-16" });
    expect(reportPeriod("weekly", new Date("2027-01-03T12:00:00Z"))).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    expect(reportPeriod("monthly", new Date("2026-11-16T12:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-16" });
  });
  it("runs the default report and sends presets, custom dates, and selected product to the authenticated API", async () => {
    const fetch = vi.fn(async url => ({ ok: true, json: async () => ({ data: url.includes("overview") ? { heads: [] } : url.includes("operations") ? { ...empty, period: Object.fromEntries(new URL(url, "https://erp.test").searchParams) } : url.includes("trial-balance") ? [] : {} }) }));
    vi.stubGlobal("fetch", fetch);
    document.body.innerHTML = '<main></main>'; const root = document.querySelector("main");
    mountReports(root, { context });
    await vi.waitFor(() => expect(root.querySelector("#reports-status").textContent).toContain("Report loaded"));
    root.querySelector('[data-report-period="weekly"]').click();
    await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes("operations?from=" + reportPeriod("weekly").from))).toBe(true));
    const form = root.querySelector("form");
    form.elements.from.value = "2026-10-01"; form.elements.to.value = "2026-10-31";
    form.elements.productId.value = "231"; form.requestSubmit();
    await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => url.endsWith("operations?from=2026-10-01&to=2026-10-31&productId=231"))).toBe(true));
    expect(root.textContent).toContain("Cumulative account totals");
  });
  it("updates desktop and mobile sales/profit cards with exact dates and negative net profit", async () => {
    document.body.innerHTML = dashboardMarkup();
    const metric = vi.fn(async (_context, key) => ({ data: { value: key === "loss" ? "12" : key === "profit" ? "0" : "45" } }));
    mountDashboard(document.body, { context, getMetric: metric, getEstimateCount: async () => ({ data: { count: 31 } }), getStock: async () => ({ data: { items: [], recent_activity: [] } }) });
    await vi.waitFor(() => expect(document.querySelector("[data-desktop-profit-value]").textContent).toContain("12"));
    expect(document.querySelector("[data-desktop-profit-note]").textContent).toContain(reportPeriod("monthly").from);
    document.querySelector('[data-sales-range="weekly"]').click();
    document.querySelector('[data-profit-card-range="daily"]').click();
    await vi.waitFor(() => expect(document.querySelector("[data-mobile-profit-note]").textContent).toContain(reportPeriod("daily").from));
    expect(metric).toHaveBeenCalledWith(context, "sales", reportPeriod("weekly"));
    expect(metric).toHaveBeenCalledWith(context, "loss", reportPeriod("daily"));
  });
  it("shows movement calendar dates and real quantity columns and exports dated report scopes", () => {
    expect(stockMovementsMarkup([{ movement_type: "SALE", created_at: "2026-10-23T20:00:00Z", quantity: 1 }])).toContain("2026-10-24");
    expect(invoiceListMarkup([{ id: 1, quantity: 7 }])).toContain("<th>Quantity</th>");
    expect(purchaseListMarkup([{ id: 1, quantity: 9 }])).toContain("<th>Quantity</th>");
    const r = { ...empty, period: { from: "2026-10-01", to: "2026-10-31" } };
    expect(operationsMarkup(r)).toContain("Reconciled");
    expect(operationsCsv(r)).toContain('"From","2026-10-01","To","2026-10-31"');
  });
});

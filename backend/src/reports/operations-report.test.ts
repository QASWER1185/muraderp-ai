import { describe, expect, it } from "vitest";
import { projectOperationsReport, type ReportSources } from "./operations-report.js";

const period = { from: "2026-10-01", to: "2026-10-31" };
function fixture(): ReportSources {
  return {
    invoices: [{ id: 15, status: "PAID", issue_date: "2026-10-24", grand_total: 1672, currency_code: "PKR" }, { id: 16, status: "POSTED", issue_date: "2026-10-24", grand_total: 1, currency_code: "PKR" }, { id: 29, status: "DRAFT", issue_date: "2026-10-24", grand_total: 30205.28, currency_code: "PKR" }],
    credits: [{ id: 4, status: "POSTED", credit_date: "2026-10-24", grand_total: 360, currency_code: "PKR" }],
    items: [{ id: 12, invoice_id: 15, product_id: 231, quantity: 1, line_total: 1312, unit_cost: 1200 }, { id: 13, invoice_id: 15, product_id: 271, quantity: 1, line_total: 360, unit_cost: 300 }, { id: 14, invoice_id: 16, product_id: 578, quantity: 1, line_total: 1, unit_cost: 1 }],
    returnItems: [{ id: 4, credit_note_id: 4, product_id: 271, quantity: 1, line_total: 360, unit_cost: 300 }],
    products: [{ id: 231, name: "Pipe", unit: "length", purchase_price: 9999 }, { id: 271, name: "Elbow", unit: "pcs", purchase_price: 9999 }, { id: 578, name: "Audit", unit: "pcs", purchase_price: 1 }],
    movements: [{ id: 32, product_id: 231, movement_type: "PURCHASE", quantity: 5, unit_cost: 1200, created_at: "2026-10-24T08:00:00Z" }, { id: 34, product_id: 231, movement_type: "SALE", quantity: 1, unit_cost: 1200, reference_type: "INVOICE", reference_id: 15, created_at: "2026-10-24T09:00:00Z" }, { id: 41, product_id: 231, movement_type: "ADJUSTMENT", quantity: 4, quantity_delta: -4, created_at: "2026-11-11T17:34:00Z" }],
    ledger: [{ code: "4000", entry_date: "2026-10-24", debit: 0, credit: 1673 }, { code: "4000", entry_date: "2026-10-24", debit: 360, credit: 0 }, { code: "5000", entry_date: "2026-10-24", debit: 1501, credit: 300 }],
  };
}
describe("daily sales, stock and realized profit", () => {
  it("keeps every calendar day, includes the posted audit invoice, and ties October to the ledger without mutations", () => {
    const source = fixture(), snapshot = JSON.stringify(source), r = projectOperationsReport(source, period, 231);
    expect(r.sales.daily).toHaveLength(31);
    expect(r.sales.daily[0]).toMatchObject({ date: "2026-10-01", netSales: "0.0000" });
    expect(r.sales.totals).toMatchObject({ invoicesCount: 2, quantitySold: "3.0000", grossSales: "1673.0000", returns: "360.0000", netSales: "1313.0000" });
    expect(r.profit.totals).toEqual({ revenue: "1313.0000", cogs: "1201.0000", grossProfit: "112.0000" });
    expect(r.profit.reconciliation).toMatchObject({ revenueVariance: "0.0000", cogsVariance: "0.0000" });
    expect(r.profit.rows.find(p => p.productId === 271)).toMatchObject({ revenue: "0.0000", cogs: "0.0000", grossProfit: "0.0000" });
    expect(r.product?.totals).toMatchObject({ purchased: "5.0000", sold: "1.0000", closingStock: "4.0000", profit: "112.0000" });
    expect(r.sales.weekly.reduce((n, row) => n + Number(row.netSales), 0)).toBe(1313);
    expect(JSON.stringify(source)).toBe(snapshot);
  });
  it("carries opening stock and posts the signed cleanup in November, never backdating it", () => {
    const r = projectOperationsReport(fixture(), { from: "2026-11-01", to: "2026-11-15" }, 231);
    expect(r.sales.daily).toHaveLength(15);
    expect(r.sales.totals.netSales).toBe("0.0000");
    expect(r.product?.totals).toMatchObject({ openingStock: "4.0000", adjustments: "-4.0000", closingStock: "0.0000" });
  });
  it("uses Karachi midnight, including boundary movements and excluding later movements", () => {
    const s = fixture();
    s.movements = [{ product_id: 231, quantity: 2, movement_type: "PURCHASE", created_at: "2026-09-30T19:00:00Z" }, { product_id: 231, quantity: 7, movement_type: "PURCHASE", created_at: "2026-10-31T19:00:00Z" }];
    expect(projectOperationsReport(s, period, 231).product?.totals).toMatchObject({ openingStock: "0.0000", purchased: "2.0000", closingStock: "2.0000" });
  });
  it("reports real reconciliation variance and follows cost fallback precedence", () => {
    const s = fixture(); s.items[0]!.unit_cost = null;
    expect(projectOperationsReport(s, period).profit.totals.cogs).toBe("1201.0000");
    s.movements = []; s.products[0]!.purchase_price = 1100;
    const r = projectOperationsReport(s, period);
    expect(r.profit.totals.cogs).toBe("1101.0000");
    expect(r.profit.reconciliation.cogsVariance).toBe("-100.0000");
  });
  it("allocates discounted invoice revenue exactly once, including rounding residue", () => {
    const s = fixture(); s.invoices[0]!.grand_total = 1000;
    const r = projectOperationsReport(s, period);
    expect(r.profit.rows.reduce((n, p) => n + Number(p.revenue), 0)).toBe(641);
    expect(r.sales.totals.netSales).toBe("641.0000");
  });
  it("fails closed for missing source cost, missing lines and mixed currencies", () => {
    const s = fixture(); s.items[0]!.unit_cost = null; s.movements = []; s.products[0]!.purchase_price = null;
    expect(() => projectOperationsReport(s, period)).toThrow("missing or invalid");
    expect(() => projectOperationsReport({ ...fixture(), items: [] }, period)).toThrow("lines");
    const mixed = fixture(); mixed.invoices[0]!.currency_code = "USD";
    expect(() => projectOperationsReport(mixed, period)).toThrow("mixed currencies");
  });
});

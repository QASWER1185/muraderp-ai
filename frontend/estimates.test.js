import { describe, expect, it } from "vitest";
import {
  applyReviewedRateChanges,
  calculateDraftTotals,
  createEstimateLine,
  estimatePageMarkup,
  estimatePreviewMarkup,
  estimateRateReviewMarkup,
  meaningfulEstimateLines,
  normalizeEstimateLines,
  previewableEstimateDraft,
  validateEstimateDraft,
} from "./estimates.js";

function draft() {
  return {
    customerId: 7,
    customerName: "Ali Traders",
    phone: "03001234567",
    address: "Lahore",
    estimateNumber: "EST-101",
    issueDate: "2026-09-14",
    notes: "Delivery included",
    overallDiscount: 45,
    carriageDelivery: 750,
    rateListId: 4,
    rateListName: "GM",
    lines: [
      createEstimateLine({ key: "cement", productId: 10, productLabel: "Cement", quantity: 10, unit: "bag", rate: 1200 }),
      createEstimateLine({ key: "bricks", productId: 20, productLabel: "Bricks", quantity: 1000, unit: "piece", rate: 18 }),
      createEstimateLine({ key: "entry" }),
    ],
  };
}

describe("estimate entry rows", () => {
  it("automatically adds exactly one next row after a product line is complete", () => {
    const completed = createEstimateLine({ key: "one", productId: 10, productLabel: "Cement", quantity: 1, unit: "bag", rate: 1200 });
    const rows = normalizeEstimateLines([completed], () => createEstimateLine({ key: "next" }));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe(completed);
    expect(rows[1]).toMatchObject({ key: "next", productId: null, productLabel: "" });
  });

  it("continues one row at a time without accumulating empty rows", () => {
    const first = createEstimateLine({ key: "one", productId: 10, productLabel: "Cement", quantity: 1, unit: "bag", rate: 1200 });
    const afterFirst = normalizeEstimateLines([first], () => createEstimateLine({ key: "two" }));
    const second = { ...afterFirst[1], productId: 20, productLabel: "Bricks", unit: "piece", rate: 18 };
    const afterSecond = normalizeEstimateLines([afterFirst[0], second], () => createEstimateLine({ key: "three" }));
    const normalized = normalizeEstimateLines([...afterSecond, createEstimateLine({ key: "extra" })]);
    expect(normalized.slice(0, 2).map((line) => line.key)).toEqual(["one", "two"]);
    expect(normalized).toHaveLength(3);
    expect(meaningfulEstimateLines(normalized)).toHaveLength(2);
  });

  it("keeps one empty trailing entry row but excludes it from meaningful Estimate data", () => {
    const value = draft();
    const normalized = normalizeEstimateLines([...value.lines, createEstimateLine({ key: "extra" })]);
    expect(normalized).toHaveLength(3);
    expect(meaningfulEstimateLines(normalized)).toHaveLength(2);
    expect(validateEstimateDraft({ ...value, lines: normalized }).lines).toHaveLength(2);
  });
});

describe("estimate document calculations", () => {
  it("calculates one percentage discount, its rupee amount, amount after discount, and Grand Total", () => {
    expect(calculateDraftTotals(draft().lines, 45, 750)).toEqual({
      subtotal: 30000,
      discountPercent: 45,
      discountAmount: 13500,
      amountAfterDiscount: 16500,
      discount: 13500,
      carriageDelivery: 750,
      grandTotal: 17250,
    });
  });

  it("validates only business fields and emits Estimate-level totals", () => {
    expect(validateEstimateDraft(draft())).toEqual({
      customer_id: 7,
      estimate_number: "EST-101",
      issue_date: "2026-09-14",
      currency_code: "PKR",
      notes: "Delivery included",
      overall_discount: 13500,
      carriage_delivery: 750,
      default_rate_list_id: 4,
      lines: [
        { product_id: 10, quantity: 10, unit: "bag", unit_price: 1200 },
        { product_id: 20, quantity: 1000, unit: "piece", unit_price: 18 },
      ],
    });
  });

  it("rejects an Estimate discount percentage outside 0 to 100", () => {
    const value = draft(); value.overallDiscount = 101;
    expect(() => validateEstimateDraft(value)).toThrow("between 0 and 100");
  });

  it("renders the current unsaved draft with percentage totals and no Unit, per-item discount, or technical IDs", () => {
    const markup = estimatePreviewMarkup({ ...draft(), savedEstimateId: null, lines: meaningfulEstimateLines(draft().lines) });
    for (const text of ["MURAD BUILDING MATERIALS STORE", "0308 6235608", "Al Kabir Town", "GM", "Discount (45%)", "Amount After Discount", "Carriage / Delivery", "Grand Total"]) expect(markup).toContain(text);
    expect(markup).toContain("<th>#</th><th>Item</th><th>Quantity</th><th>Rate</th><th>Total</th>");
    expect(markup).not.toContain("<th>Unit</th>");
    expect(markup).not.toContain(">bag<");
    expect(markup.match(/<th>Discount<\/th>/)).toBeNull();
    expect(markup).not.toMatch(/Organization ID|Branch ID|Source Estimate ID|UUID/i);
  });

  it("prepares a partial unsaved draft for preview without invoking save validation", () => {
    const value = { ...draft(), customerName: "", phone: "", lines: [createEstimateLine({ key: "partial", productLabel: "Pending item", quantity: 2, rate: 500 })] };
    expect(() => validateEstimateDraft(value)).toThrow("Customer name is required");
    expect(previewableEstimateDraft(value)).toMatchObject({ customerName: "", phone: "", lines: [{ key: "partial", productLabel: "Pending item", quantity: 2, rate: 500 }] });
    expect(estimatePreviewMarkup(previewableEstimateDraft(value))).toContain("Pending item");
  });

  it("renders the exact editor columns, percentage input, and calculated discount labels", () => {
    const markup = estimatePageMarkup();
    expect(markup).toContain("<th>#</th><th>Item</th><th>Quantity</th><th>Rate</th><th>Total</th><th>Action</th>");
    expect(markup).toContain('max="100"');
    expect(markup).toContain('class="percentage-field"');
    expect(markup).toContain("Discount Amount");
    expect(markup).toContain("Amount After Discount");
    expect(markup).not.toContain("<th>Unit</th>");
    expect(markup).not.toContain('name="unit"');
  });
});

describe("rate-list review application", () => {
  it("does not expose Unit in the rate-list review UI", () => {
    const value = draft();
    const markup = estimateRateReviewMarkup({ lines: [
      { product_id: 10, old_rate: 1200, new_rate: 1250, status: "MATCHED", message: null },
      { product_id: 20, old_rate: 18, new_rate: 19, status: "MATCHED", message: null },
    ] }, meaningfulEstimateLines(value.lines));
    expect(markup).toContain("<th>Item</th><th>Quantity</th><th>Old Rate</th><th>New Rate</th><th>Total</th><th>Status</th>");
    expect(markup).not.toContain("Unit");
    expect(markup).not.toContain("bag");
  });

  it("changes only rates and rate context while preserving items, quantities, units, order, and trailing row", () => {
    const value = draft();
    const changed = applyReviewedRateChanges(value.lines, [
      { product_id: 10, new_rate: 1250, status: "MATCHED" },
      { product_id: 20, new_rate: 19, status: "MATCHED" },
    ], 9);
    expect(changed.map(({ key, productId, quantity, unit, rate, rateListId }) => ({ key, productId, quantity, unit, rate, rateListId }))).toEqual([
      { key: "cement", productId: 10, quantity: 10, unit: "bag", rate: 1250, rateListId: 9 },
      { key: "bricks", productId: 20, quantity: 1000, unit: "piece", rate: 19, rateListId: 9 },
      { key: "entry", productId: null, quantity: 1, unit: "unit", rate: 0, rateListId: null },
    ]);
  });

  it("refuses unmatched reviews instead of silently substituting a product", () => {
    const value = draft();
    expect(() => applyReviewedRateChanges(value.lines, [
      { product_id: 10, new_rate: 1250, status: "MATCHED" },
      { product_id: 999, new_rate: null, status: "UNMATCHED" },
    ], 9)).toThrow("safely matched");
    expect(value.lines[1]).toMatchObject({ productId: 20, rate: 18 });
  });
});

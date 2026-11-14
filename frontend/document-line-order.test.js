// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { orderedDocumentLines, mobileDocumentPreview } from "./document-templates.js";
import { savedEstimatePreviewMarkup } from "./estimate-register.js";
import { invoiceDetailMarkup } from "./invoices.js";
import { createEstimatePdfFile, createSavedEstimatePdfFile, savedEstimateRows } from "./estimate-pdf.js";

// Deliberately interleave categories, brands and headings; API array order is shuffled.
const entered = Array.from({ length: 45 }, (_, index) => ({
  line_number: index + 1, product_name: `Entered item ${String(index + 1).padStart(2, "0")}`,
  productLabel: `Entered item ${String(index + 1).padStart(2, "0")}`,
  category: `Category ${index % 4}`, brand: `Brand ${index % 3}`,
  quantity: 2, unit: "pcs", list_price: 100, discount_percent: 10, unit_price: 90, line_total: 180, rate: 90,
}));
const shuffled = [...entered.slice(24), ...entered.slice(0, 24)].reverse();
const estimate = { estimate_number: "EST-ORDER", issue_date: "2026-11-14", status: "DRAFT",
  customer: { name: "Order Test" }, lines: shuffled, subtotal: 8100, discount_total: 0,
  grand_total: 8100, pass_through_rent: 0, customer_payable_total: 8100 };
function dom(markup) { const root = document.createElement("div"); root.innerHTML = markup; return root; }
const names = (root, selector) => [...root.querySelectorAll(selector)].map(node => node.textContent);
const expectedNames = entered.map(line => line.product_name);
const expectedNumbers = entered.map(line => String(line.line_number));

describe("entered document line order across previews, print and exports", () => {
  it("sorts only by numeric saved line number without mutating or dropping source lines", () => {
    const before = structuredClone(shuffled);
    expect(orderedDocumentLines(shuffled)).toEqual(entered);
    expect(orderedDocumentLines(shuffled.map(line => ({ ...line, line_number: String(line.line_number) }))).map(line => Number(line.line_number))).toEqual(entered.map(line => line.line_number));
    expect(savedEstimateRows(estimate).map(({line}) => line)).toEqual(entered);
    expect(shuffled).toEqual(before);
    const unsaved = [{ product_name: "Z" }, { product_name: "A" }];
    expect(orderedDocumentLines(unsaved)).toEqual(unsaved);
  });
  it.each(["sanitary_electric", "building_material"])("renders 45 uninterrupted saved/print and mobile rows for %s", template => {
    const root = dom(savedEstimatePreviewMarkup({ ...estimate, document_template: template }));
    expect(names(root, ".saved-estimate-lines tbody tr td:nth-child(2)")).toEqual(expectedNames);
    expect(names(root, ".saved-estimate-lines tbody tr td:first-child")).toEqual(expectedNumbers);
    expect(names(root, ".document-line-name")).toEqual(expectedNames);
    expect(names(root, ".document-line-number")).toEqual(expectedNumbers);
    expect(root.querySelectorAll(".estimate-category,.estimate-category-total,.document-item-group,.document-group-subtotal")).toHaveLength(0);
    expect(root.textContent).toContain("8,100.00");
  });
  it("renders existing invoice desktop and mobile lines in the same entered order", () => {
    const root = dom(invoiceDetailMarkup({ invoice: { ...estimate, invoice_number: "INV-ORDER" }, lines: shuffled }));
    expect([...root.querySelectorAll(".invoice-detail-lines>div>span")].map(node => node.textContent.split(" · ")[0])).toEqual(expectedNames);
    expect(names(root, ".document-line-name")).toEqual(expectedNames);
    expect(names(root, ".document-line-number")).toEqual(expectedNumbers);
    expect(root.querySelector(".document-item-group")).toBeNull();
  });
  it.each(["estimate", "invoice"])("draws all saved %s PDF/image rows and SRs in sequence without category blocks", async documentType => {
    const drawn = [];
    const ctx = { measureText: value => ({width: String(value).length * 8}), fillText: (value,x,y) => drawn.push({value:String(value),x,y}),
      fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
    const canvas = {getContext: () => ctx, toDataURL: () => "data:image/jpeg;base64,/9j/2Q=="};
    const doc = {fonts: {load: vi.fn().mockResolvedValue([]), ready: Promise.resolve()}, createElement: () => canvas};
    const before = structuredClone(estimate);
    const file = await createSavedEstimatePdfFile(estimate, {name:"Store",categories:"All items",phone:"Phone",address:"Address"}, doc, {documentType});
    expect(file.type).toBe("application/pdf");
    expect(drawn.filter(({x}) => x === 124).slice(1).map(({value}) => value)).toEqual(expectedNames);
    expect(drawn.filter(({x}) => x === 60).slice(1).map(({value}) => value)).toEqual(expectedNumbers);
    expect(drawn.some(({value}) => /Category/i.test(value))).toBe(false);
    expect(estimate).toEqual(before);
  });
  it("preserves entered sequence across draft PDF page boundaries", async () => {
    const file = createEstimatePdfFile({estimateNumber:"ORDER",lines:shuffled}, {subtotal:8100,grandTotal:8100});
    const text = await file.text();
    let previous = -1;
    for (const name of expectedNames) { const position = text.indexOf(`(${name})`); expect(position).toBeGreaterThan(previous); previous = position; }
    expect(text).not.toContain("Category");
  });
});

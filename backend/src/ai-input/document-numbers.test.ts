import { describe, expect, it } from "vitest";
import { parseDocumentNumber, normalizeDocumentDate, westernDigits } from "./document-numbers.js";
import { businessDocumentSchema, normalizeBusinessNumbers } from "./business-input.provider.js";
import { MultimodalAgentInput } from "../ai-copilot/agent/multimodal-input.js";
import { scope } from "../ai-copilot/agent/stateful.test-fixtures.js";

describe("recovered field-scoped document number normalization", () => {
  it.each(["۳۶۱", "361", "٣٦١", "۳6١"])("normalizes numeric field %s with its original", value => expect(parseDocumentNumber(value)).toEqual({ value: 361, original: value, issue: null }));
  it.each(["1,250", "۱٬۲۵۰", "١,٢٥٠"])("validates thousands groups %s", value => expect(parseDocumentNumber(value).value).toBe(1250));
  it.each(["۱۲٫۵۰", "١٢.٥٠", "12.50"])("parses decimal %s", value => expect(parseDocumentNumber(value).value).toBe(12.5));
  it.each(["1,25", "25 × 1/2\"", "25mm", "۲ PCS", "12?", "9007199254740992", "-2"])("does not guess ambiguous numeric field %s", value => {
    expect(parseDocumentNumber(value).value).toBeNull(); expect(parseDocumentNumber(value).issue).toBeTruthy();
  });
  it("validates actual ISO dates without rewriting identifiers", () => {
    expect(normalizeDocumentDate("۲۰۲۶-۱۰-۱۱").value).toBe("2026-10-11");
    expect(normalizeDocumentDate("2026-02-30").issue).toBeTruthy();
    expect(normalizeDocumentDate("11/10/26").issue).toBeTruthy();
    expect(westernDigits("25 × 1/2\"، INV-۰۰۱")).toBe("25 × 1/2\"، INV-001");
  });
  const raw = () => ({ customerName: null, vendorName: null, warehouseName: null, documentNumber: "INV-۰۰۱", documentDate: "۲۰۲۶-۱۰-۱۱", currencyCode: "PKR", lines: [{ productName: "ELBOW 25 × 1/2\"", productCode: "EFM-۰۰۱", brandHint: null, quantity: "۲", unit: "PCS", unitRate: "۳۶۱", discountPercent: "۴۰", confidence: 1 }], discountPercent: "۴۰", subtotal: "۷۲۲", total: "۴۳۳٫۲", confidence: 1, warnings: [] });
  it("adapts recovered numbers to the current strict multimodal contract without using observed prices as ERP authority", () => {
    const original = raw();
    const document = businessDocumentSchema.parse(normalizeBusinessNumbers(original));
    expect(document).toMatchObject({ documentNumber: "INV-۰۰۱", documentDate: "2026-10-11", total: 433.2, lines: [{ quantity: 2, unitRate: 361, discountPercent: 40, productCode: "EFM-۰۰۱" }] });
    expect(original.lines[0]!.quantity).toBe("۲");
  });
  it("requires source review for illegible numbers and does not pass observed rates into the agent request", async () => {
    const original = raw(); original.lines[0]!.quantity = "۲ PCS";
    const document = businessDocumentSchema.parse(normalizeBusinessNumbers(original));
    const provider = { extract: async () => ({ draftId: "proposal", ...scope, source: "image" as const, intent: "estimate.create" as const, status: "draft" as const, requiresConfirmation: true as const, fields: { document: { value: document, source: "image" as const, confidence: 1 } } }) };
    const result = await new MultimodalAgentInput(provider).normalize({ source: "image", media: { mimeType: "image/png", base64: "test" } }, scope);
    expect(result.reviewRequired).toBe(false);
    expect(result.extraction.document?.lines[0]?.quantity).toBeNull();
    expect(result.message).not.toContain('"unitRate"');
    expect(result.message).not.toContain('"total"');
  });
});

import { describe, expect, it } from "vitest";
import { attachmentLabel, reviewCardMarkup, selectReviewProduct, sourceForAttachment } from "./copilot-ui.js";

describe("conversational Copilot UI", () => {
  it("classifies voice, camera, image, and text inputs", () => {
    expect(sourceForAttachment(null)).toBe("text");
    expect(sourceForAttachment({ type: "audio/webm" })).toBe("voice");
    expect(sourceForAttachment({ type: "image/jpeg" }, true)).toBe("camera");
    expect(sourceForAttachment({ type: "application/pdf" })).toBe("image");
  });

  it("shows a useful attachment label", () => { expect(attachmentLabel({ name: "invoice.pdf", size: 2048 })).toBe("invoice.pdf | 2 KB"); });

  it("renders human labels while keeping identifiers out of visible labels", () => {
    const markup = reviewCardMarkup({ intent: "estimate", confidence: .92, customer: { status: "matched", selectedId: 19, candidates: [{ id: 19, label: "Ali Traders", confidence: .97 }] }, vendor: { status: "not_requested", candidates: [] }, warehouse: { status: "not_requested", candidates: [] }, lines: [{ productName: "Popular Pipe", quantity: 50, unit: "pcs", explicitUnitRate: null, product: { selectedId: 7, candidates: [{ id: 7, label: "Popular Pipe 25mm", confidence: .96 }] }, rateList: { candidates: [] }, warnings: [] }], blockingReasons: [] });
    expect(markup).toContain("Ali Traders");
    expect(markup).toContain("Popular Pipe 25mm");
    expect(markup).not.toContain("Product ID");
    expect(markup).toContain("Prepare draft");
  });

  it("shows authoritative sale rate and amount in an estimate review", () => {
    const markup = reviewCardMarkup({ intent: "estimate", confidence: 1, lines: [{ productName: "PIPE 25MM", quantity: 2, unit: "MTR", product: { selectedId: 7, candidates: [{ id: 7, label: "PIPE 25MM PN-16", confidence: 1 }] }, rateList: { selectedId: 40, candidates: [{ id: 40, label: "Store Standard Rates" }] }, resolvedPrice: { rate_list_id: 40, unit_price: 365, unit: "MTR", currency_code: "PKR" }, amount: 730, warnings: [] }], blockingReasons: [] });
    expect(markup).toContain("PKR 365 / MTR");
    expect(markup).toContain("PKR 730");
    expect(markup).not.toContain("Needs verification");
    expect(markup).not.toContain("data-prepare-draft disabled");
  });

  it("blocks draft preparation when the sale rate cannot be verified", () => {
    const markup = reviewCardMarkup({ intent: "estimate", confidence: 1, lines: [{ productName: "PIPE 25MM", quantity: 2, unit: "FOOT", product: { selectedId: 7, candidates: [{ id: 7, label: "PIPE 25MM PN-16", confidence: 1 }] }, rateList: { candidates: [] }, warnings: ["Sale rate uses MTR, while the request uses FOOT."] }], blockingReasons: ["line-1:unit mismatch"] });
    expect(markup).toContain("Needs verification");
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("data-prepare-draft disabled");
  });

  it("clears stale product ambiguity after an explicit selection", () => {
    const line = { product: { status: "ambiguous", candidates: [{ id: 7 }, { id: 8 }] }, warnings: ["Multiple products match this line; choose one.", "No current authorized sale rate was found."] };
    selectReviewProduct(line, 7);
    expect(line.product).toMatchObject({ status: "matched", selectedId: 7 });
    expect(line.warnings).toEqual(["No current authorized sale rate was found."]);
  });
});

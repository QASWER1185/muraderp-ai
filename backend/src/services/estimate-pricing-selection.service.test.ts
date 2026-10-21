import { describe, expect, it } from "vitest";
import { resolveEstimatePricingInstruction } from "./estimate-pricing-selection.service.js";

describe("resolveEstimatePricingInstruction", () => {
  it("accepts an explicit rate-list selection", () => {
    expect(
      resolveEstimatePricingInstruction(null, {
        selection: {
          mode: "RATE_LIST",
          rate_list_id: 12,
          source: "LINE_OVERRIDE",
        },
      }),
    ).toEqual({
      mode: "RATE_LIST",
      rate_list_id: 12,
      source: "LINE_OVERRIDE",
    });
  });

  it("inherits the estimate default rate list when no line selection exists", () => {
    expect(resolveEstimatePricingInstruction(7, {})).toEqual({
      mode: "RATE_LIST",
      rate_list_id: 7,
      source: "INHERITED",
    });
  });

  it("does not turn an AI/OCR brand hint into an implicit financial rate list", () => {
    expect(() =>
      resolveEstimatePricingInstruction(null, {
        brand_hint: "Popular",
      }),
    ).toThrow("brand_hint requires an explicit resolved rate_list_id");
  });

  it("requires a pricing selection when neither a line selection nor estimate default exists", () => {
    expect(() => resolveEstimatePricingInstruction(null, {})).toThrow(
      "no pricing selection available for estimate line",
    );
  });
});

import { describe, expect, it } from "vitest";
import { pricingContract } from "./phase22-pricing-contract.js";

describe("Phase 22 pricing authority", () => {
  it("preserves selected rate list and keeps pricing server authoritative", () => {
    expect(pricingContract("popular", "120")).toEqual({
      rateListId: "popular",
      explicitRateText: "120",
      resolutionAuthority: "backend",
      allowClientInventedRate: false
    });
  });
});

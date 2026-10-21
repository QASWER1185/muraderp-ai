import { describe, expect, it } from "vitest";
import { getEstimateActions } from "../types/estimate-action.types.js";

describe("estimate action availability", () => {
  it("allows print and WhatsApp sharing for drafts", () => {
    const actions = getEstimateActions("DRAFT");
    expect(actions.find((a) => a.action === "PRINT")?.enabled).toBe(true);
    expect(actions.find((a) => a.action === "SHARE_WHATSAPP")?.enabled).toBe(true);
    expect(actions.find((a) => a.action === "CONVERT_TO_QUOTATION")?.enabled).toBe(false);
  });

  it("allows quotation conversion only after ready", () => {
    const actions = getEstimateActions("READY");
    expect(actions.find((a) => a.action === "CONVERT_TO_QUOTATION")?.enabled).toBe(true);
  });

  it("disables commercial actions after conversion or cancellation", () => {
    for (const status of ["CONVERTED", "CANCELLED"] as const) {
      const actions = getEstimateActions(status);
      expect(actions.every((a) => !a.enabled)).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import type { AiInputDraft } from "../src/ai-input/ai-input.types.js";
import {
  assertDraftBelongsToContext,
  transitionDraftStatus,
} from "../src/ai-input/draft-lifecycle.js";

const draft: AiInputDraft = {
  draftId: "draft-1",
  source: "image",
  intent: "supplier_bill.create",
  organizationId: "org-1",
  status: "draft",
  fields: {
    vendor: { value: "Vendor A", confidence: 0.98, source: "image" },
  },
  requiresConfirmation: true,
};

describe("AI input draft lifecycle", () => {
  it("requires validation before confirmation", () => {
    const validated = transitionDraftStatus(draft, "validated");
    expect(validated.status).toBe("validated");

    const confirmed = transitionDraftStatus(validated, "confirmed");
    expect(confirmed.status).toBe("confirmed");
  });

  it("rejects direct draft-to-confirmed transitions", () => {
    expect(() => transitionDraftStatus(draft, "confirmed")).toThrow(
      "Invalid AI input draft transition",
    );
  });

  it("rejects transitions from terminal states", () => {
    const rejected = transitionDraftStatus(draft, "rejected");
    expect(() => transitionDraftStatus(rejected, "validated")).toThrow(
      "Invalid AI input draft transition",
    );
  });

  it("prevents cross-organization draft confirmation context", () => {
    expect(() => assertDraftBelongsToContext(draft, "org-2")).toThrow(
      "AI input draft organization mismatch",
    );
    expect(() => assertDraftBelongsToContext(draft, "org-1")).not.toThrow();
  });
});

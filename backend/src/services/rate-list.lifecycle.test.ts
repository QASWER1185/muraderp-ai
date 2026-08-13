import { describe, expect, it } from "vitest";

function validateTransition(current: "DRAFT" | "ACTIVE" | "ARCHIVED", next: "DRAFT" | "ACTIVE" | "ARCHIVED") {
  const allowed: Record<typeof current, typeof next[]> = {
    DRAFT: ["DRAFT", "ACTIVE"],
    ACTIVE: ["ACTIVE", "ARCHIVED"],
    ARCHIVED: ["ARCHIVED"],
  };

  if (!allowed[current].includes(next)) {
    throw new Error(`invalid rate-list version transition: ${current} -> ${next}`);
  }
}

describe("rate-list version lifecycle", () => {
  it("allows draft to become active", () => {
    expect(() => validateTransition("DRAFT", "ACTIVE")).not.toThrow();
  });

  it("allows active to become archived", () => {
    expect(() => validateTransition("ACTIVE", "ARCHIVED")).not.toThrow();
  });

  it("does not allow archived versions to become active", () => {
    expect(() => validateTransition("ARCHIVED", "ACTIVE")).toThrow(
      "invalid rate-list version transition: ARCHIVED -> ACTIVE",
    );
  });

  it("does not allow active versions to return to draft", () => {
    expect(() => validateTransition("ACTIVE", "DRAFT")).toThrow(
      "invalid rate-list version transition: ACTIVE -> DRAFT",
    );
  });
});

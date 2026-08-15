import { describe, expect, it } from "vitest";
import { DeterministicIntentResolver } from "../src/ai-assistant/deterministic-intent.resolver.js";

describe("DeterministicIntentResolver", () => {
  const resolver = new DeterministicIntentResolver();

  it("recognizes invoice draft requests", () => {
    expect(resolver.resolve("Create an invoice").intent).toBe("invoice.create_draft");
  });

  it("recognizes supplier bill draft requests", () => {
    expect(resolver.resolve("Prepare a supplier bill").intent).toBe("supplier_bill.create_draft");
  });

  it("recognizes inventory read requests", () => {
    expect(resolver.resolve("Show stock").intent).toBe("inventory.lookup");
  });

  it("does not guess unknown requests", () => {
    expect(resolver.resolve("something unrelated").intent).toBeNull();
    expect(resolver.resolve("something unrelated").decision).toBe("clarify");
  });
});

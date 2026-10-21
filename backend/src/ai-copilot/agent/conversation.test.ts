import { afterEach, describe, expect, it, vi } from "vitest";
import { readConversation, writeConversation } from "./conversation.js";

const scope = { userId: "user-a", organizationId: "org-a", branchId: "branch-a" };
afterEach(() => vi.useRealTimers());

describe("bounded signed conversation", () => {
  it("keeps long Urdu turns below the route limit and retains the latest verified product", () => {
    const context = { candidates: [{ id: 7, name: "Pipe", sku: "P-7", unit: "MTR" }], ambiguous: false };
    let token: string | undefined;
    for (let turn = 0; turn < 5; turn++) {
      token = writeConversation(scope, readConversation(token, scope), "ا".repeat(500), "ب".repeat(1200), context);
      expect(token.length).toBeLessThanOrEqual(9000);
      expect(readConversation(token, scope).at(-1)?.productContext).toEqual(context);
    }
  });

  it("rejects expired context", () => {
    vi.useFakeTimers();
    const token = writeConversation(scope, [], "Pipe", "Verified");
    vi.advanceTimersByTime(30 * 60_000 + 1);
    expect(readConversation(token, scope)).toEqual([]);
  });

  it("bounds a single multibyte turn with the maximum candidate context", () => {
    const context = { candidates: Array.from({ length: 5 }, (_, index) => ({ id: index + 1, name: "界".repeat(160), sku: "界".repeat(100), unit: "界".repeat(30) })), ambiguous: true };
    const token = writeConversation(scope, [], "界".repeat(500), "界".repeat(1200), context);
    expect(token.length).toBeLessThanOrEqual(9000);
    expect(readConversation(token, scope).at(-1)?.productContext).toEqual(context);
  });
});

import { describe, expect, it, vi } from "vitest";
import { SupabaseSalesReturnBrowserRepository } from "./sales-return-browser.repository.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";

function query(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), lt: vi.fn(), ilike: vi.fn(), maybeSingle: vi.fn(),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const name of ["select", "eq", "order", "limit", "lt", "ilike"] as const) builder[name].mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue(result);
  return builder;
}

describe("Sales return browser repository", () => {
  it("scopes the register query to organization and branch before pagination", async () => {
    const notes = query({ data: [{ id: 8 }, { id: 7 }, { id: 6 }], error: null });
    const from = vi.fn().mockReturnValue(notes);
    const repository = new SupabaseSalesReturnBrowserRepository(() => ({ from } as never));
    expect(await repository.list(organizationId, branchId, 2, 9, "CN-7")).toEqual({ data: [{ id: 8 }, { id: 7 }], next_cursor: 7 });
    expect(from).toHaveBeenCalledWith("credit_notes");
    expect(notes.eq).toHaveBeenCalledWith("organization_id", organizationId);
    expect(notes.eq).toHaveBeenCalledWith("branch_id", branchId);
    expect(notes.lt).toHaveBeenCalledWith("id", 9);
    expect(notes.ilike).toHaveBeenCalledWith("credit_note_number", "%CN-7%");
  });

  it("does not query credit-note items when the scoped header is absent", async () => {
    const notes = query({ data: null, error: null });
    const from = vi.fn().mockReturnValue(notes);
    const repository = new SupabaseSalesReturnBrowserRepository(() => ({ from } as never));
    expect(await repository.getById(organizationId, branchId, 12)).toBeNull();
    expect(notes.eq).toHaveBeenCalledWith("organization_id", organizationId);
    expect(notes.eq).toHaveBeenCalledWith("branch_id", branchId);
    expect(notes.eq).toHaveBeenCalledWith("id", 12);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("searches numeric input by invoice ID within the selected branch", async () => {
    const notes = query({ data: [], error: null });
    const repository = new SupabaseSalesReturnBrowserRepository(() => ({ from: vi.fn().mockReturnValue(notes) } as never));
    await repository.list(organizationId, branchId, 25, undefined, "41");
    expect(notes.eq).toHaveBeenCalledWith("invoice_id", 41);
    expect(notes.eq).toHaveBeenCalledWith("organization_id", organizationId);
    expect(notes.eq).toHaveBeenCalledWith("branch_id", branchId);
  });
});

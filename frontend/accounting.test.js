import { afterEach, describe, expect, it, vi } from "vitest";
import { getJournalEntry, listAccountLedger, listAccounts, listJournalEntries } from "./accounting-api.js";
import { accountsMarkup, entriesMarkup, entryMarkup, ledgerMarkup } from "./accounting.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
afterEach(() => vi.unstubAllGlobals());

describe("Accounting browser integration", () => {
  it("uses authenticated, scoped, read-only APIs", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetch);
    await listAccounts(context);
    await listJournalEntries(context, { limit: 20, offset: 20 });
    await getJournalEntry(context, "entry-id");
    await listAccountLedger(context, "account-id", { offset: 50 });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/browser/accounting/accounts",
      "/api/v1/browser/accounting/entries?limit=20&offset=20",
      "/api/v1/browser/accounting/entries/entry-id",
      "/api/v1/browser/accounting/accounts/account-id/ledger?limit=50&offset=50",
    ]);
    for (const [, options] of fetch.mock.calls) {
      expect(options.credentials).toBe("include");
      expect(options.headers).toEqual({ "X-Organization-Id": context.organizationId, "X-Branch-Id": context.branchId });
    }
  });

  it("shows escaped journal and ledger data with balanced line totals", () => {
    const accounts = accountsMarkup([{ id: "a", code: "1000", name: "<Cash>", account_type: "ASSET", normal_balance: "DEBIT" }]);
    expect(accounts).toContain("&lt;Cash&gt;");
    expect(accounts).toContain('class="table"');
    expect(accounts).not.toContain("stock-table");
    expect(entriesMarkup([{ id: "e", entry_date: "2026-09-30", description: "<Sale>", source_type: "INVOICE", source_record_id: "14", status: "POSTED" }])).toContain("&lt;Sale&gt;");
    const detail = entryMarkup({ description: "Sale", lines: [{ account_id: "a", accounts: { code: "1000", name: "Cash" }, debit: 5, credit: 0 }, { account_id: "b", debit: 0, credit: 5 }] });
    expect(detail).toContain("5.00");
    expect(ledgerMarkup({ code: "1000", name: "<Cash>" }, [])).toContain("&lt;Cash&gt;");
  });
});

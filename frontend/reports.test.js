import { afterEach, describe, expect, it, vi } from "vitest";
import { getFinancialSummary, getReportHead, getReportOverview, getTrialBalance } from "./reports-api.js";
import { summaryMarkup, trialBalanceMarkup } from "./reports.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
const period = { from: "2026-09-01", to: "2026-09-30" };
afterEach(() => vi.unstubAllGlobals());

describe("Reports browser integration", () => {
  it("uses authenticated, scoped read-only endpoints", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetch);
    await getReportOverview(context);
    await getFinancialSummary(context, period);
    await getTrialBalance(context, period);
    await getReportHead(context, "profit", period);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/browser/reports/overview",
      "/api/v1/browser/reports/summary?from=2026-09-01&to=2026-09-30",
      "/api/v1/browser/reports/trial-balance?from=2026-09-01&to=2026-09-30",
      "/api/v1/browser/reports/details?head=profit&from=2026-09-01&to=2026-09-30",
    ]);
    for (const [, options] of fetch.mock.calls) {
      expect(options.credentials).toBe("include");
      expect(options.headers).toEqual({ "X-Organization-Id": context.organizationId, "X-Branch-Id": context.branchId });
    }
  });

  it("escapes account names and displays verified totals", () => {
    expect(summaryMarkup({ totalDebits: "12.0000", totalCredits: "12.0000", netIncome: "2.0000" })).toContain("12.00");
    const trial = trialBalanceMarkup([{ code: "1000", name: "<Cash>", account_type: "ASSET", total_debit: "12", total_credit: "0", net_balance: "12" }]);
    expect(trial).toContain("&lt;Cash&gt;");
    expect(trial).not.toContain("<Cash>");
  });
});

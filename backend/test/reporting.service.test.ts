import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "../src/auth/authorization.service.js";
import { ReportingService } from "../src/reports/reporting.service.js";

describe("ReportingService", () => {
  const period = { from: "2026-08-01", to: "2026-08-31" };

  it("requires reports.view before returning financial data", async () => {
    const gateway = { getFinancialSummary: vi.fn(), getDashboardSummary: vi.fn(), getDashboardDetail: vi.fn() };
    const auth = new AuthorizationService({ hasPermission: vi.fn().mockResolvedValue(false) });
    const service = new ReportingService(gateway, auth);

    await expect(service.getFinancialSummary("user-1", "org-1", period)).rejects.toMatchObject({ status: 403 });
    expect(gateway.getFinancialSummary).not.toHaveBeenCalled();
  });

  it("returns the canonical financial summary for an authorized user", async () => {
    const summary = { totalDebits: "100.00", totalCredits: "100.00", netIncome: "25.00", receivables: "40.00", payables: "15.00", cashAndBank: "60.00" };
    const gateway = { getFinancialSummary: vi.fn().mockResolvedValue(summary), getDashboardSummary: vi.fn(), getDashboardDetail: vi.fn() };
    const auth = new AuthorizationService({ hasPermission: vi.fn().mockResolvedValue(true) });
    const service = new ReportingService(gateway, auth);

    await expect(service.getFinancialSummary("user-1", "org-1", period)).resolves.toEqual(summary);
    expect(gateway.getFinancialSummary).toHaveBeenCalledWith("org-1", period);
  });

  it("returns dashboard heads without exposing any figures on initial load", async () => {
    const gateway = { getFinancialSummary: vi.fn(), getDashboardSummary: vi.fn(), getDashboardDetail: vi.fn() };
    const auth = new AuthorizationService({ hasPermission: vi.fn().mockResolvedValue(true) });
    const service = new ReportingService(gateway, auth);

    const overview = await service.getDashboardOverview("user-1", "org-1");

    expect(overview.heads.map((head) => head.key)).toEqual([
      "sales",
      "purchases",
      "receivables",
      "payables",
      "profit",
      "loss",
    ]);
    expect(overview).not.toHaveProperty("sales");
    expect(overview).not.toHaveProperty("receivables");
    expect(overview).not.toHaveProperty("payables");
    expect(overview).not.toHaveProperty("profit");
    expect(overview).not.toHaveProperty("loss");
    expect(gateway.getDashboardSummary).not.toHaveBeenCalled();
    expect(gateway.getDashboardDetail).not.toHaveBeenCalled();
  });

  it("reveals a figure only through explicit dashboard-head drill-down", async () => {
    const detail = { key: "payables" as const, label: "Payables", value: "125000.00", period };
    const gateway = { getFinancialSummary: vi.fn(), getDashboardSummary: vi.fn(), getDashboardDetail: vi.fn().mockResolvedValue(detail) };
    const auth = new AuthorizationService({ hasPermission: vi.fn().mockResolvedValue(true) });
    const service = new ReportingService(gateway, auth);

    await expect(service.getDashboardDetail("user-1", "org-1", "payables", period)).resolves.toEqual(detail);
    expect(gateway.getDashboardDetail).toHaveBeenCalledWith("org-1", "payables", period);
  });

  it("does not expose dashboard figures to an unauthorized user", async () => {
    const gateway = { getFinancialSummary: vi.fn(), getDashboardSummary: vi.fn(), getDashboardDetail: vi.fn() };
    const auth = new AuthorizationService({ hasPermission: vi.fn().mockResolvedValue(false) });
    const service = new ReportingService(gateway, auth);

    await expect(service.getDashboardOverview("unknown-user", "org-1")).rejects.toMatchObject({ status: 403 });
    await expect(service.getDashboardDetail("unknown-user", "org-1", "profit", period)).rejects.toMatchObject({ status: 403 });
    expect(gateway.getDashboardDetail).not.toHaveBeenCalled();
  });
});

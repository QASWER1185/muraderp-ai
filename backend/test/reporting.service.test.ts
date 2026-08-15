import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "../src/auth/authorization.service.js";
import { ReportingService } from "../src/reports/reporting.service.js";

describe("ReportingService", () => {
  const period = { from: "2026-08-01", to: "2026-08-31" };

  it("requires reports.view before returning financial data", async () => {
    const gateway = { getFinancialSummary: vi.fn(), getDashboardSummary: vi.fn() };
    const auth = new AuthorizationService({ hasPermission: vi.fn().mockResolvedValue(false) });
    const service = new ReportingService(gateway, auth);

    await expect(service.getFinancialSummary("user-1", "org-1", period)).rejects.toMatchObject({ status: 403 });
    expect(gateway.getFinancialSummary).not.toHaveBeenCalled();
  });

  it("returns the canonical financial summary for an authorized user", async () => {
    const summary = { totalDebits: "100.00", totalCredits: "100.00", netIncome: "25.00", receivables: "40.00", payables: "15.00", cashAndBank: "60.00" };
    const gateway = { getFinancialSummary: vi.fn().mockResolvedValue(summary), getDashboardSummary: vi.fn() };
    const auth = new AuthorizationService({ hasPermission: vi.fn().mockResolvedValue(true) });
    const service = new ReportingService(gateway, auth);

    await expect(service.getFinancialSummary("user-1", "org-1", period)).resolves.toEqual(summary);
    expect(gateway.getFinancialSummary).toHaveBeenCalledWith("org-1", period);
  });
});

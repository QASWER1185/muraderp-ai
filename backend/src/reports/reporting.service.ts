import type { AuthorizationService } from "../auth/authorization.service.js";
import { DASHBOARD_HEADS, type DashboardHead, type DashboardOverview } from "./dashboard.types.js";
import type { DashboardHeadDetail, DashboardSummary, FinancialSummary, ReportPeriod, ReportingGateway } from "./reporting.types.js";

export class ReportingService {
  constructor(
    private readonly gateway: ReportingGateway,
    private readonly authorization: AuthorizationService,
  ) {}

  async getFinancialSummary(userId: string, organizationId: string, period: ReportPeriod): Promise<FinancialSummary> {
    await this.authorization.assertPermission(userId, organizationId, "reports.view");
    return this.gateway.getFinancialSummary(organizationId, period);
  }

  /**
   * Privacy-first dashboard landing payload.
   * It deliberately contains no financial figures, totals, percentages, or chart data.
   */
  async getDashboardOverview(userId: string, organizationId: string): Promise<DashboardOverview> {
    await this.authorization.assertPermission(userId, organizationId, "reports.view");
    return {
      heads: DASHBOARD_HEADS.map((key) => ({
        key,
        label: key === "sales" ? "Sales" : key === "purchases" ? "Purchases" : key === "receivables" ? "Receivables" : key === "payables" ? "Payables" : key === "profit" ? "Profit" : "Loss",
      })),
    };
  }

  /**
   * Figures are returned only after an explicit dashboard-head drill-down.
   */
  async getDashboardDetail(
    userId: string,
    organizationId: string,
    head: DashboardHead,
    period: ReportPeriod,
  ): Promise<DashboardHeadDetail> {
    await this.authorization.assertPermission(userId, organizationId, "reports.view");
    return this.gateway.getDashboardDetail(organizationId, head, period);
  }

  /** @deprecated Use getDashboardOverview followed by getDashboardDetail. */
  async getDashboardSummary(userId: string, organizationId: string, period: ReportPeriod): Promise<DashboardSummary> {
    await this.authorization.assertPermission(userId, organizationId, "reports.view");
    return this.gateway.getDashboardSummary(organizationId, period);
  }
}

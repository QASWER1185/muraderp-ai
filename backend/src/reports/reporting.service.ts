import type { AuthorizationService } from "../auth/authorization.service.js";
import type { DashboardSummary, FinancialSummary, ReportPeriod, ReportingGateway } from "./reporting.types.js";

export class ReportingService {
  constructor(
    private readonly gateway: ReportingGateway,
    private readonly authorization: AuthorizationService,
  ) {}

  async getFinancialSummary(userId: string, organizationId: string, period: ReportPeriod): Promise<FinancialSummary> {
    await this.authorization.assertPermission(userId, organizationId, "reports.view");
    return this.gateway.getFinancialSummary(organizationId, period);
  }

  async getDashboardSummary(userId: string, organizationId: string, period: ReportPeriod): Promise<DashboardSummary> {
    await this.authorization.assertPermission(userId, organizationId, "reports.view");
    return this.gateway.getDashboardSummary(organizationId, period);
  }
}

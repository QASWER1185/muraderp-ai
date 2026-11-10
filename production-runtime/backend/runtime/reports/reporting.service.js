import { DASHBOARD_HEADS } from "./dashboard.types.js";
export class ReportingService {
    gateway;
    authorization;
    constructor(gateway, authorization) {
        this.gateway = gateway;
        this.authorization = authorization;
    }
    async getFinancialSummary(userId, organizationId, period) {
        await this.authorization.assertPermission(userId, organizationId, "reports.view");
        return this.gateway.getFinancialSummary(organizationId, period);
    }
    /**
     * Privacy-first dashboard landing payload.
     * It deliberately contains no financial figures, totals, percentages, or chart data.
     */
    async getDashboardOverview(userId, organizationId) {
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
    async getDashboardDetail(userId, organizationId, head, period) {
        await this.authorization.assertPermission(userId, organizationId, "reports.view");
        return this.gateway.getDashboardDetail(organizationId, head, period);
    }
    /** @deprecated Use getDashboardOverview followed by getDashboardDetail. */
    async getDashboardSummary(userId, organizationId, period) {
        await this.authorization.assertPermission(userId, organizationId, "reports.view");
        return this.gateway.getDashboardSummary(organizationId, period);
    }
}
//# sourceMappingURL=reporting.service.js.map
export interface ReportPeriod {
  from: string;
  to: string;
}

export interface FinancialSummary {
  totalDebits: string;
  totalCredits: string;
  netIncome: string;
  receivables: string;
  payables: string;
  cashAndBank: string;
}

/**
 * Legacy aggregate used by detailed reporting only.
 * It must never be used as the initial dashboard payload.
 */
export interface DashboardSummary extends FinancialSummary {
  sales: string;
  purchases: string;
  receipts: string;
  payments: string;
  salesReturns: string;
  purchaseReturns: string;
  stockValue: string;
}

export interface DashboardHeadDetail {
  key: import("./dashboard.types.js").DashboardHead;
  label: string;
  value: string;
  period: ReportPeriod;
}

export interface ReportingGateway {
  getFinancialSummary(organizationId: string, period: ReportPeriod): Promise<FinancialSummary>;
  getDashboardSummary(organizationId: string, period: ReportPeriod): Promise<DashboardSummary>;
  getDashboardDetail(
    organizationId: string,
    head: import("./dashboard.types.js").DashboardHead,
    period: ReportPeriod,
  ): Promise<DashboardHeadDetail>;
}

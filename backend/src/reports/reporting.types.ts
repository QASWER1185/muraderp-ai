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

export interface DashboardSummary extends FinancialSummary {
  sales: string;
  purchases: string;
  receipts: string;
  payments: string;
  salesReturns: string;
  purchaseReturns: string;
  stockValue: string;
}

export interface ReportingGateway {
  getFinancialSummary(organizationId: string, period: ReportPeriod): Promise<FinancialSummary>;
  getDashboardSummary(organizationId: string, period: ReportPeriod): Promise<DashboardSummary>;
}

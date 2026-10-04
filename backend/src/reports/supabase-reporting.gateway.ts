import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { Database } from "../types/database.types.js";
import type { DashboardHead } from "./dashboard.types.js";
import type { DashboardHeadDetail, DashboardSummary, FinancialSummary, ReportPeriod, ReportingGateway } from "./reporting.types.js";

type LedgerLine = {
  journal_entry_id: string;
  entry_date: string;
  source_type: string;
  code: string;
  debit: string | number;
  credit: string | number;
};
type Account = { code: string; account_type: string; name: string; normal_balance: string };
type Client = { from(table: string): any };

function decimal(value: string | number): bigint {
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d{1,4}))?$/);
  if (!match) throw new ApiError(502, "REPORTING_INVALID_AMOUNT", "Accounting amount could not be read");
  const scaled = BigInt(match[2]!) * 10000n + BigInt((match[3] ?? "").padEnd(4, "0"));
  return match[1] ? -scaled : scaled;
}

function format(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 10000n}.${String(absolute % 10000n).padStart(4, "0")}`;
}

function sum(lines: LedgerLine[], part: "debit" | "credit"): bigint {
  return lines.reduce((total, line) => total + decimal(line[part]), 0n);
}

export function projectFinancialReport(accounts: Account[], allLines: LedgerLine[], period: ReportPeriod) {
  const types = new Map(accounts.map((account) => [account.code, account.account_type]));
  const periodLines = allLines.filter((line) => line.entry_date >= period.from && line.entry_date <= period.to);
  const accountNet = (rows: LedgerLine[], code: string) => rows.filter((line) => line.code === code).reduce((total, line) => total + decimal(line.debit) - decimal(line.credit), 0n);
  const revenue = periodLines.filter((line) => types.get(line.code) === "REVENUE").reduce((total, line) => total + decimal(line.credit) - decimal(line.debit), 0n);
  const expenses = periodLines.filter((line) => types.get(line.code) === "EXPENSE").reduce((total, line) => total + decimal(line.debit) - decimal(line.credit), 0n);
  const netIncome = revenue - expenses;
  const purchases = periodLines.filter((line) => line.source_type === "PURCHASE" && line.code === "2000").reduce((total, line) => total + decimal(line.credit) - decimal(line.debit), 0n);
  const cashAndBank = ["1000", "1010", "1090"].reduce((total, code) => total + accountNet(allLines, code), 0n);
  const summary: FinancialSummary = {
    totalDebits: format(sum(periodLines, "debit")),
    totalCredits: format(sum(periodLines, "credit")),
    netIncome: format(netIncome),
    receivables: format(accountNet(allLines, "1100")),
    payables: format(-accountNet(allLines, "2000")),
    cashAndBank: format(cashAndBank),
  };
  const heads = {
    sales: format(revenue),
    purchases: format(purchases),
    receivables: summary.receivables,
    payables: summary.payables,
    profit: format(netIncome > 0n ? netIncome : 0n),
    loss: format(netIncome < 0n ? -netIncome : 0n),
  };
  const cashCodes = new Set(["1000", "1010", "1090"]);
  const legacy = {
    receipts: format(periodLines.filter((line) => line.source_type === "CUSTOMER_PAYMENT" && cashCodes.has(line.code)).reduce((total, line) => total + decimal(line.debit), 0n)),
    payments: format(periodLines.filter((line) => line.source_type === "VENDOR_PAYMENT" && cashCodes.has(line.code)).reduce((total, line) => total + decimal(line.credit), 0n)),
    salesReturns: format(periodLines.filter((line) => line.source_type === "CREDIT_NOTE" && types.get(line.code) === "REVENUE").reduce((total, line) => total + decimal(line.debit), 0n)),
    purchaseReturns: format(periodLines.filter((line) => line.source_type === "PURCHASE_RETURN" && line.code === "2000").reduce((total, line) => total + decimal(line.debit), 0n)),
    stockValue: format(accountNet(allLines, "1200")),
  };
  const trialBalance = accounts.map((account) => {
    const rows = allLines.filter((line) => line.code === account.code);
    const debit = sum(rows, "debit");
    const credit = sum(rows, "credit");
    return {
      code: account.code, name: account.name, account_type: account.account_type,
      normal_balance: account.normal_balance, total_debit: format(debit), total_credit: format(credit),
      net_balance: format(debit - credit),
    };
  });
  return { summary, heads, legacy, trialBalance };
}

export class SupabaseReportingGateway implements ReportingGateway {
  constructor(
    private readonly branchId: string,
    private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseServiceRoleClient,
  ) {}

  private get client(): Client { return this.clientFactory() as unknown as Client; }

  private async read(organizationId: string, period: ReportPeriod) {
    const { data: accounts, error: accountError } = await this.client.from("accounts")
      .select("code,name,account_type,normal_balance").order("code", { ascending: true });
    if (accountError) throw new ApiError(502, "REPORTING_READ_FAILED", "Report accounts could not be loaded");
    const lines: LedgerLine[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client.from("general_ledger")
        .select("journal_entry_id,entry_date,source_type,code,debit,credit")
        .eq("organization_id", organizationId).eq("branch_id", this.branchId)
        .lte("entry_date", period.to)
        .order("entry_date", { ascending: true }).order("journal_entry_id", { ascending: true }).order("code", { ascending: true })
        .range(offset, offset + 499);
      if (error) throw new ApiError(502, "REPORTING_READ_FAILED", "Posted general ledger could not be loaded");
      lines.push(...(data ?? []));
      if ((data ?? []).length < 500) break;
    }
    return projectFinancialReport(accounts ?? [], lines, period);
  }

  async getFinancialSummary(organizationId: string, period: ReportPeriod): Promise<FinancialSummary> {
    return (await this.read(organizationId, period)).summary;
  }

  async getDashboardDetail(organizationId: string, head: DashboardHead, period: ReportPeriod): Promise<DashboardHeadDetail> {
    const result = await this.read(organizationId, period);
    const labels: Record<DashboardHead, string> = { sales: "Sales", purchases: "Purchases", receivables: "Receivables", payables: "Payables", profit: "Profit", loss: "Loss" };
    return { key: head, label: labels[head], value: result.heads[head], period };
  }

  async getTrialBalance(organizationId: string, period: ReportPeriod) {
    return (await this.read(organizationId, period)).trialBalance;
  }

  async getDashboardSummary(organizationId: string, period: ReportPeriod): Promise<DashboardSummary> {
    const result = await this.read(organizationId, period);
    return {
      ...result.summary, sales: result.heads.sales, purchases: result.heads.purchases, ...result.legacy,
    };
  }
}

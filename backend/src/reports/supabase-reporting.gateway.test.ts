import { describe, expect, it } from "vitest";
import { projectFinancialReport } from "./supabase-reporting.gateway.js";

const accounts = [
  { code: "1000", name: "Cash", account_type: "ASSET", normal_balance: "DEBIT" },
  { code: "1100", name: "Receivables", account_type: "ASSET", normal_balance: "DEBIT" },
  { code: "1200", name: "Inventory", account_type: "ASSET", normal_balance: "DEBIT" },
  { code: "2000", name: "Payables", account_type: "LIABILITY", normal_balance: "CREDIT" },
  { code: "4000", name: "Sales", account_type: "REVENUE", normal_balance: "CREDIT" },
  { code: "5000", name: "Cost", account_type: "EXPENSE", normal_balance: "DEBIT" },
];
const line = (code: string, debit: string, credit: string, entry_date: string, source_type = "INVOICE") => ({ journal_entry_id: `${entry_date}-${code}`, entry_date, source_type, code, debit, credit });

describe("posted general-ledger reporting projection", () => {
  it("uses exact four-decimal totals and carries balance-sheet accounts through the end date", () => {
    const lines = [
      line("1000", "10.0000", "0", "2026-08-31", "CUSTOMER_PAYMENT"),
      line("1100", "0", "10.0000", "2026-08-31", "CUSTOMER_PAYMENT"),
      line("1100", "950.0000", "0", "2026-09-29"),
      line("4000", "0", "950.0000", "2026-09-29"),
      line("5000", "750.0000", "0", "2026-09-29"),
      line("1200", "0", "750.0000", "2026-09-29"),
      line("4000", "950.0000", "0", "2026-09-30", "CREDIT_NOTE"),
      line("1100", "0", "950.0000", "2026-09-30", "CREDIT_NOTE"),
      line("1200", "750.0000", "0", "2026-09-30", "CREDIT_NOTE"),
      line("5000", "0", "750.0000", "2026-09-30", "CREDIT_NOTE"),
    ];
    const result = projectFinancialReport(accounts, lines, { from: "2026-09-01", to: "2026-09-30" });
    expect(result.summary).toEqual({ totalDebits: "3400.0000", totalCredits: "3400.0000", netIncome: "0.0000", receivables: "-10.0000", payables: "0.0000", cashAndBank: "10.0000" });
    expect(result.heads.sales).toBe("0.0000");
    expect(result.legacy.salesReturns).toBe("950.0000");
    expect(result.trialBalance.find((row) => row.code === "1100")?.net_balance).toBe("-10.0000");
  });
});

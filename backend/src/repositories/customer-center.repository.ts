import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { Database } from "../types/database.types.js";

type UntypedClient = { from(table: string): any };
export interface CustomerCenterRange { from?: string; to?: string }
export interface CustomerCenterMetrics {
  balance: number;
  opening_balance: number;
  estimates_count: number;
  estimates_total_amount: number;
  invoices_total_amount: number;
  payments_total_amount: number;
  has_activity_in_range?: boolean;
}
export interface CustomerCenterRepository {
  listMetrics(organizationId: string, branchId: string, customerIds: number[], range?: CustomerCenterRange): Promise<Map<number, CustomerCenterMetrics>>;
  getCenter(organizationId: string, branchId: string, customerId: number, range?: CustomerCenterRange): Promise<CustomerCenterMetrics & {
    estimates: Array<Record<string, unknown>>;
    invoices: Array<Record<string, unknown>>;
    returns: Array<Record<string, unknown>>;
    payments: Array<Record<string, unknown>>;
  }>;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const inRange = (date: string | null | undefined, range?: CustomerCenterRange) =>
  Boolean(date && (!range?.from || date >= range.from) && (!range?.to || date <= range.to));
const dateRangeActive = (range?: CustomerCenterRange) => Boolean(range?.from || range?.to);

export class SupabaseCustomerCenterRepository implements CustomerCenterRepository {
  constructor(private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseServiceRoleClient) {}
  private get client(): UntypedClient { return this.clientFactory() as unknown as UntypedClient; }

  private async rows(table: string, columns: string, organizationId: string, branchId: string, customerIds: number[]) {
    if (!customerIds.length) return [] as any[];
    const result: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.client.from(table).select(columns)
        .eq("organization_id", organizationId).eq("branch_id", branchId)
        .in("customer_id", customerIds).order("id", { ascending: true }).range(offset, offset + 999);
      if (error) throw new ApiError(502, "CUSTOMER_CENTER_READ_FAILED", "Customer transaction history could not be loaded");
      result.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    return result;
  }

  private async lineTotals(estimateIds: number[]) {
    const totals = new Map<number, number>();
    if (!estimateIds.length) return totals;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.client.from("estimate_items")
        .select("estimate_id, quantity, unit_price, discount_amount")
        .in("estimate_id", estimateIds).order("estimate_id").range(offset, offset + 999);
      if (error) throw new ApiError(502, "CUSTOMER_CENTER_READ_FAILED", "Estimate totals could not be loaded");
      for (const item of data ?? []) {
        // The direct estimate_items rows retain the pre-discount unit rate; subtract
        // the stored line discount to match the estimate API's grand_total.
        const lineAmount = money(Number(item.quantity) * Number(item.unit_price) - Number(item.discount_amount ?? 0));
        totals.set(Number(item.estimate_id), money((totals.get(Number(item.estimate_id)) ?? 0) + lineAmount));
      }
      if ((data ?? []).length < 1000) break;
    }
    return totals;
  }

  private async build(organizationId: string, branchId: string, customerIds: number[], range?: CustomerCenterRange) {
    if (!customerIds.length) return new Map<number, any>();
    const [customerResult, estimates, invoices, returns, payments] = await Promise.all([
      this.client.from("customers").select("id, opening_balance").eq("organization_id", organizationId).in("id", customerIds),
      this.rows("estimates", "id, estimate_number, customer_id, issue_date, status, pass_through_rent", organizationId, branchId, customerIds),
      this.rows("invoices", "id, invoice_number, customer_id, issue_date, status, grand_total, pass_through_rent", organizationId, branchId, customerIds),
      this.rows("credit_notes", "id, credit_note_number, invoice_id, customer_id, credit_date, status, grand_total", organizationId, branchId, customerIds),
      this.rows("customer_payments", "id, customer_id, payment_date, amount, payment_method, reference_number", organizationId, branchId, customerIds),
    ]);
    if (customerResult.error) throw new ApiError(502, "CUSTOMER_CENTER_READ_FAILED", "Customer opening balances could not be loaded");
    const openingBalances = new Map<number, number>((customerResult.data ?? []).map((item: any) => [Number(item.id), Number(item.opening_balance ?? 0)]));
    const invoiceIds = invoices.filter((item) => ["POSTED", "PARTIALLY_PAID", "PAID"].includes(item.status)).map((item) => Number(item.id));
    let allocations: any[] = [];
    if (invoiceIds.length) {
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await this.client.from("customer_payment_allocations")
          .select("invoice_id, amount").eq("organization_id", organizationId).eq("branch_id", branchId)
          .in("invoice_id", invoiceIds).order("invoice_id").range(offset, offset + 999);
        if (error) throw new ApiError(502, "CUSTOMER_CENTER_READ_FAILED", "Invoice payments could not be loaded");
        allocations.push(...(data ?? []));
        if ((data ?? []).length < 1000) break;
      }
    }
    const estimateTotals = await this.lineTotals(estimates.map((item) => Number(item.id)));
    const paidByInvoice = new Map<number, number>();
    for (const allocation of allocations) {
      const invoiceId = Number(allocation.invoice_id);
      paidByInvoice.set(invoiceId, money((paidByInvoice.get(invoiceId) ?? 0) + Number(allocation.amount)));
    }
    const creditByInvoice = new Map<number, number>();
    for (const item of returns) {
      if (item.status !== "POSTED") continue;
      const invoiceId = Number(item.invoice_id);
      creditByInvoice.set(invoiceId, money((creditByInvoice.get(invoiceId) ?? 0) + Number(item.grand_total)));
    }
    const result = new Map<number, any>();
    for (const customerId of customerIds) {
      const customerEstimates = estimates.filter((item) => Number(item.customer_id) === customerId);
      const customerInvoices = invoices.filter((item) => Number(item.customer_id) === customerId && ["POSTED", "PARTIALLY_PAID", "PAID"].includes(item.status));
      const customerReturns = returns.filter((item) => Number(item.customer_id) === customerId && item.status === "POSTED");
      const customerPayments = payments.filter((item) => Number(item.customer_id) === customerId);
      const invoiceTotal = money(customerInvoices.reduce((sum, item) => sum + Number(item.grand_total) + Number(item.pass_through_rent ?? 0), 0));
      const paymentTotal = money(customerPayments.reduce((sum, item) => sum + Number(item.amount), 0));
      const returnTotal = money(customerReturns.reduce((sum, item) => sum + Number(item.grand_total), 0));
      const openingBalance = openingBalances.get(customerId) ?? 0;
      const estimateTotal = money(customerEstimates.reduce((sum, item) => sum + (estimateTotals.get(Number(item.id)) ?? 0), 0));
      const transactions = [
        ...customerEstimates.map((item) => item.issue_date),
        ...invoices.filter((item) => Number(item.customer_id) === customerId).map((item) => item.issue_date),
        ...returns.filter((item) => Number(item.customer_id) === customerId).map((item) => item.credit_date),
        ...customerPayments.map((item) => item.payment_date),
      ];
      const hasActivity = transactions.some((date) => inRange(date, range));
      result.set(customerId, {
        balance: money(openingBalance + invoiceTotal - paymentTotal - returnTotal),
        opening_balance: openingBalance,
        estimates_count: customerEstimates.filter((item) => item.status !== "CANCELLED").length,
        estimates_total_amount: estimateTotal,
        invoices_total_amount: invoiceTotal,
        payments_total_amount: paymentTotal,
        ...(dateRangeActive(range) ? { has_activity_in_range: hasActivity } : {}),
        estimates: customerEstimates.map((item) => ({
          id: Number(item.id), estimate_number: item.estimate_number, issue_date: item.issue_date,
          grand_total: estimateTotals.get(Number(item.id)) ?? 0,
          pass_through_rent: Number(item.pass_through_rent ?? 0),
          status: item.status === "CONVERTED" ? "INVOICED" : item.status,
        })).filter((item) => inRange(String(item.issue_date), range)).sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)) || Number(b.id) - Number(a.id)),
        invoices: customerInvoices.map((item) => {
          const id = Number(item.id);
          const grandTotal = Number(item.grand_total);
          const paid = paidByInvoice.get(id) ?? 0;
          const credited = creditByInvoice.get(id) ?? 0;
          return {
            id, invoice_number: item.invoice_number, issue_date: item.issue_date,
            grand_total: grandTotal, paid_amount: paid,
            outstanding_amount: money(grandTotal + Number(item.pass_through_rent ?? 0) - paid - credited), status: item.status,
          };
        }).filter((item) => inRange(String(item.issue_date), range)).sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)) || Number(b.id) - Number(a.id)),
        returns: customerReturns.map((item) => ({
          id: Number(item.id), return_number: item.credit_note_number, return_date: item.credit_date, total_amount: Number(item.grand_total),
        })).filter((item) => inRange(String(item.return_date), range)).sort((a, b) => String(b.return_date).localeCompare(String(a.return_date)) || Number(b.id) - Number(a.id)),
        payments: customerPayments.map((item) => ({
          id: Number(item.id), payment_number: `REC-${item.id}`, payment_date: item.payment_date,
          amount: Number(item.amount), payment_method: item.payment_method, reference_number: item.reference_number ?? null,
        })).filter((item) => inRange(String(item.payment_date), range)).sort((a, b) => String(b.payment_date).localeCompare(String(a.payment_date)) || Number(b.id) - Number(a.id)),
      });
    }
    return result;
  }

  async listMetrics(organizationId: string, branchId: string, customerIds: number[], range?: CustomerCenterRange) {
    const result = await this.build(organizationId, branchId, customerIds, range);
    for (const [id, value] of result) {
      const { estimates, invoices, returns, payments, ...metrics } = value;
      result.set(id, metrics);
    }
    return result as Map<number, CustomerCenterMetrics>;
  }

  async getCenter(organizationId: string, branchId: string, customerId: number, range?: CustomerCenterRange) {
    const result = await this.build(organizationId, branchId, [customerId], range);
    return result.get(customerId) ?? {
      balance: 0, opening_balance: 0, estimates_count: 0, estimates_total_amount: 0, invoices_total_amount: 0,
      payments_total_amount: 0, estimates: [], invoices: [], returns: [], payments: [],
    };
  }
}

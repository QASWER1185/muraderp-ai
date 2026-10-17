import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { Database } from "../types/database.types.js";

type UntypedClient = { from(table: string): any };

export interface ReceivableSummary {
  invoice_id: number;
  invoice_number: string;
  customer_id: number;
  customer_name: string;
  status: string;
  currency_code: string;
  invoice_total: number;
  paid: number;
  credited: number;
  outstanding: number;
}

export interface PaymentSummary {
  id: number;
  customer_id: number;
  payment_date: string;
  amount: number;
  currency_code: string;
  payment_method: string;
  reference_number: string | null;
  notes: string | null;
}

export interface PaymentAllocationSummary {
  id: number;
  payment_id: number;
  invoice_id: number;
  amount: number;
  invoice_number: string;
}

export interface CustomerPaymentBrowserRepository {
  listReceivables(organizationId: string, branchId: string, limit: number, cursor?: number, filter?: { customerId: number; invoiceIds?: number[] }): Promise<{ data: ReceivableSummary[]; next_cursor: number | null }>;
  allocationInvoices(organizationId: string, branchId: string, invoiceIds: number[]): Promise<Array<{ id: number; customer_id: number; currency_code: string }>>;
  listPayments(organizationId: string, branchId: string, limit: number, cursor?: number): Promise<{ data: PaymentSummary[]; next_cursor: number | null }>;
  getPayment(organizationId: string, branchId: string, id: number): Promise<{ payment: PaymentSummary; allocations: PaymentAllocationSummary[] } | null>;
}

function readError(message: string): ApiError {
  return new ApiError(502, "CUSTOMER_PAYMENT_READ_FAILED", message);
}

export class SupabaseCustomerPaymentBrowserRepository implements CustomerPaymentBrowserRepository {
  constructor(private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseServiceRoleClient) {}

  private get client(): UntypedClient {
    // The generated Database type currently omits these existing payment tables.
    return this.clientFactory() as unknown as UntypedClient;
  }

  async listReceivables(organizationId: string, branchId: string, limit: number, cursor?: number, filter?: { customerId: number; invoiceIds?: number[] }) {
    let query = this.client.from("invoices")
      .select("id, invoice_number, customer_id, status, currency_code, grand_total, pass_through_rent")
      .eq("organization_id", organizationId).eq("branch_id", branchId)
      .in("status", ["POSTED", "PARTIALLY_PAID", "PAID"])
      .order("id", { ascending: false }).limit(limit + 1);
    if (cursor !== undefined) query = query.lt("id", cursor);
    if (filter) query = query.eq("customer_id", filter.customerId);
    if (filter?.invoiceIds) query = query.in("id", filter.invoiceIds);
    const { data, error } = await query;
    if (error) throw readError("Receivables could not be loaded");
    const rows = (data ?? []) as Array<{ id: number; invoice_number: string; customer_id: number; status: string; currency_code: string; grand_total: number; pass_through_rent: number }>;
    const selected = rows.slice(0, limit);
    if (!selected.length) return { data: [], next_cursor: null };

    const invoiceIds = selected.map((row) => row.id);
    const customerIds = [...new Set(selected.map((row) => row.customer_id))];
    const [customers, allocations, credits] = await Promise.all([
      this.client.from("customers").select("id, name").eq("organization_id", organizationId).in("id", customerIds),
      this.client.from("customer_payment_allocations").select("invoice_id, amount")
        .eq("organization_id", organizationId).eq("branch_id", branchId).in("invoice_id", invoiceIds),
      this.client.from("credit_notes").select("invoice_id, grand_total")
        .eq("organization_id", organizationId).eq("branch_id", branchId).eq("status", "POSTED").in("invoice_id", invoiceIds),
    ]);
    if (customers.error || allocations.error || credits.error) throw readError("Receivable balances could not be loaded");
    const names = new Map<number, string>((customers.data ?? []).map((row: any) => [row.id, row.name]));
    const paid = new Map<number, number>();
    const credited = new Map<number, number>();
    for (const row of allocations.data ?? []) paid.set(row.invoice_id, (paid.get(row.invoice_id) ?? 0) + Number(row.amount));
    for (const row of credits.data ?? []) credited.set(row.invoice_id, (credited.get(row.invoice_id) ?? 0) + Number(row.grand_total));
    return {
      data: selected.map((row) => {
        const invoiceTotal = Number(row.grand_total) + Number(row.pass_through_rent ?? 0);
        const paidAmount = paid.get(row.id) ?? 0;
        const creditedAmount = credited.get(row.id) ?? 0;
        return {
          invoice_id: row.id, invoice_number: row.invoice_number, customer_id: row.customer_id,
          customer_name: names.get(row.customer_id) ?? `Customer #${row.customer_id}`,
          status: row.status, currency_code: row.currency_code,
          invoice_total: invoiceTotal, paid: paidAmount, credited: creditedAmount,
          outstanding: invoiceTotal - paidAmount - creditedAmount,
        };
      }),
      next_cursor: rows.length > limit ? selected[selected.length - 1]!.id : null,
    };
  }

  async allocationInvoices(organizationId: string, branchId: string, invoiceIds: number[]) {
    const { data, error } = await this.client.from("invoices").select("id, customer_id, currency_code")
      .eq("organization_id", organizationId).eq("branch_id", branchId).in("id", invoiceIds);
    if (error) throw readError("Invoice allocation could not be checked");
    return (data ?? []) as Array<{ id: number; customer_id: number; currency_code: string }>;
  }

  async listPayments(organizationId: string, branchId: string, limit: number, cursor?: number) {
    let query = this.client.from("customer_payments")
      .select("id, customer_id, payment_date, amount, currency_code, payment_method, reference_number, notes")
      .eq("organization_id", organizationId).eq("branch_id", branchId)
      .order("id", { ascending: false }).limit(limit + 1);
    if (cursor !== undefined) query = query.lt("id", cursor);
    const { data, error } = await query;
    if (error) throw readError("Customer payments could not be loaded");
    const rows = (data ?? []) as PaymentSummary[];
    return { data: rows.slice(0, limit), next_cursor: rows.length > limit ? rows[limit - 1]!.id : null };
  }

  async getPayment(organizationId: string, branchId: string, id: number) {
    const { data: payment, error } = await this.client.from("customer_payments")
      .select("id, customer_id, payment_date, amount, currency_code, payment_method, reference_number, notes")
      .eq("organization_id", organizationId).eq("branch_id", branchId).eq("id", id).maybeSingle();
    if (error) throw readError("Customer payment could not be loaded");
    if (!payment) return null;
    const { data: allocations, error: allocationError } = await this.client.from("customer_payment_allocations")
      .select("id, payment_id, invoice_id, amount")
      .eq("organization_id", organizationId).eq("branch_id", branchId).eq("payment_id", id)
      .order("id", { ascending: true });
    if (allocationError) throw readError("Customer payment allocations could not be loaded");
    const ids = (allocations ?? []).map((row: any) => row.invoice_id);
    const invoices = ids.length ? await this.client.from("invoices").select("id, invoice_number")
      .eq("organization_id", organizationId).eq("branch_id", branchId).in("id", ids) : { data: [], error: null };
    if (invoices.error) throw readError("Allocated invoices could not be loaded");
    const numbers = new Map<number, string>((invoices.data ?? []).map((row: any) => [row.id, row.invoice_number]));
    return {
      payment: payment as PaymentSummary,
      allocations: (allocations ?? []).map((row: any) => ({ ...row, invoice_number: numbers.get(row.invoice_id) ?? `Invoice #${row.invoice_id}` })) as PaymentAllocationSummary[],
    };
  }
}

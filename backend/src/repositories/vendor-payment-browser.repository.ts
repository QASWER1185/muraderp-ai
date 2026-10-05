import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { Database } from "../types/database.types.js";

type UntypedClient = { from(table: string): any };

export interface PayableSummary {
  purchase_id: number;
  purchase_date: string;
  invoice_number: string | null;
  vendor_id: number;
  vendor_name: string;
  total: number;
  paid: number;
  outstanding: number;
}

export interface VendorPaymentSummary {
  id: number;
  vendor_id: number;
  vendor_name: string;
  payment_date: string;
  amount: number;
  payment_method: string;
  reference: string | null;
  notes: string | null;
  status: string;
}

export interface VendorPaymentAllocationSummary {
  id: number;
  payment_id: number;
  purchase_id: number;
  amount: number;
  purchase_reference: string;
}

export interface VendorPaymentBrowserRepository {
  listPayables(organizationId: string, branchId: string, limit: number, cursor?: number, filter?: { vendorId: number; purchaseIds?: number[] }): Promise<{ data: PayableSummary[]; next_cursor: number | null }>;
  allocationPurchases(organizationId: string, branchId: string, purchaseIds: number[]): Promise<Array<{ id: number; vendor_id: number }>>;
  listPayments(organizationId: string, branchId: string, limit: number, cursor?: number): Promise<{ data: VendorPaymentSummary[]; next_cursor: number | null }>;
  getPayment(organizationId: string, branchId: string, id: number): Promise<{ payment: VendorPaymentSummary; allocations: VendorPaymentAllocationSummary[] } | null>;
}

function readError(message: string): ApiError {
  return new ApiError(502, "VENDOR_PAYMENT_READ_FAILED", message);
}

export class SupabaseVendorPaymentBrowserRepository implements VendorPaymentBrowserRepository {
  constructor(private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseServiceRoleClient) {}

  private get client(): UntypedClient {
    return this.clientFactory() as unknown as UntypedClient;
  }

  private async vendorNames(organizationId: string, vendorIds: number[]): Promise<Map<number, string>> {
    if (!vendorIds.length) return new Map();
    const { data, error } = await this.client.from("vendors").select("id,name")
      .eq("organization_id", organizationId).in("id", vendorIds);
    if (error) throw readError("Vendor names could not be loaded");
    return new Map<number, string>((data ?? []).map((row: any) => [row.id, row.name]));
  }

  async listPayables(organizationId: string, branchId: string, limit: number, cursor?: number, filter?: { vendorId: number; purchaseIds?: number[] }) {
    let query = this.client.from("purchases")
      .select("id,purchase_date,invoice_number,vendor_id,total")
      .eq("organization_id", organizationId).eq("branch_id", branchId)
      .order("id", { ascending: false }).limit(limit + 1);
    if (cursor !== undefined) query = query.lt("id", cursor);
    if (filter) query = query.eq("vendor_id", filter.vendorId);
    if (filter?.purchaseIds) query = query.in("id", filter.purchaseIds);
    const { data, error } = await query;
    if (error) throw readError("Purchase payables could not be loaded");
    const rows = (data ?? []) as Array<{ id: number; purchase_date: string; invoice_number: string | null; vendor_id: number; total: number }>;
    const selected = rows.slice(0, limit);
    if (!selected.length) return { data: [], next_cursor: null };

    const purchaseIds = selected.map((row) => row.id);
    const vendorIds = [...new Set(selected.map((row) => row.vendor_id))];
    const [names, allocationResult] = await Promise.all([
      this.vendorNames(organizationId, vendorIds),
      this.client.from("vendor_payment_allocations").select("purchase_id,payment_id,amount")
        .eq("organization_id", organizationId).eq("branch_id", branchId).in("purchase_id", purchaseIds),
    ]);
    if (allocationResult.error) throw readError("Vendor payment allocations could not be loaded");
    const allocations = (allocationResult.data ?? []) as Array<{ purchase_id: number; payment_id: number; amount: number }>;
    const paymentIds = [...new Set(allocations.map((row) => row.payment_id))];
    let posted = new Set<number>();
    if (paymentIds.length) {
      const { data: payments, error: paymentError } = await this.client.from("vendor_payments").select("id,status")
        .eq("organization_id", organizationId).eq("branch_id", branchId).in("id", paymentIds);
      if (paymentError) throw readError("Posted vendor payments could not be loaded");
      posted = new Set<number>((payments ?? []).filter((row: any) => row.status === "POSTED").map((row: any) => row.id));
    }
    const paid = new Map<number, number>();
    for (const row of allocations) {
      if (posted.has(row.payment_id)) paid.set(row.purchase_id, (paid.get(row.purchase_id) ?? 0) + Number(row.amount));
    }
    return {
      data: selected.map((row) => ({
        purchase_id: row.id, purchase_date: row.purchase_date, invoice_number: row.invoice_number,
        vendor_id: row.vendor_id, vendor_name: names.get(row.vendor_id) ?? `Vendor #${row.vendor_id}`,
        total: Number(row.total), paid: paid.get(row.id) ?? 0,
        outstanding: Number(row.total) - (paid.get(row.id) ?? 0),
      })),
      next_cursor: rows.length > limit ? selected[selected.length - 1]!.id : null,
    };
  }

  async allocationPurchases(organizationId: string, branchId: string, purchaseIds: number[]) {
    const { data, error } = await this.client.from("purchases").select("id,vendor_id")
      .eq("organization_id", organizationId).eq("branch_id", branchId).in("id", purchaseIds);
    if (error) throw readError("Purchase allocation could not be checked");
    return (data ?? []) as Array<{ id: number; vendor_id: number }>;
  }

  async listPayments(organizationId: string, branchId: string, limit: number, cursor?: number) {
    let query = this.client.from("vendor_payments")
      .select("id,vendor_id,payment_date,amount,payment_method,reference,notes,status")
      .eq("organization_id", organizationId).eq("branch_id", branchId)
      .order("id", { ascending: false }).limit(limit + 1);
    if (cursor !== undefined) query = query.lt("id", cursor);
    const { data, error } = await query;
    if (error) throw readError("Vendor payments could not be loaded");
    const rows = (data ?? []) as Array<Omit<VendorPaymentSummary, "vendor_name">>;
    const selected = rows.slice(0, limit);
    const names = await this.vendorNames(organizationId, [...new Set(selected.map((row) => row.vendor_id))]);
    return {
      data: selected.map((row) => ({ ...row, vendor_name: names.get(row.vendor_id) ?? `Vendor #${row.vendor_id}` })),
      next_cursor: rows.length > limit ? selected[selected.length - 1]!.id : null,
    };
  }

  async getPayment(organizationId: string, branchId: string, id: number) {
    const { data: payment, error } = await this.client.from("vendor_payments")
      .select("id,vendor_id,payment_date,amount,payment_method,reference,notes,status")
      .eq("organization_id", organizationId).eq("branch_id", branchId).eq("id", id).maybeSingle();
    if (error) throw readError("Vendor payment could not be loaded");
    if (!payment) return null;
    const { data: allocations, error: allocationError } = await this.client.from("vendor_payment_allocations")
      .select("id,payment_id,purchase_id,amount")
      .eq("organization_id", organizationId).eq("branch_id", branchId).eq("payment_id", id)
      .order("id", { ascending: true });
    if (allocationError) throw readError("Vendor payment allocations could not be loaded");
    const purchaseIds = (allocations ?? []).map((row: any) => row.purchase_id);
    const purchases = purchaseIds.length ? await this.client.from("purchases")
      .select("id,invoice_number").eq("organization_id", organizationId).eq("branch_id", branchId)
      .in("id", purchaseIds) : { data: [], error: null };
    if (purchases.error) throw readError("Allocated purchases could not be loaded");
    const references = new Map<number, string>((purchases.data ?? []).map((row: any) => [row.id, row.invoice_number || `Purchase #${row.id}`]));
    const names = await this.vendorNames(organizationId, [payment.vendor_id]);
    return {
      payment: { ...(payment as Omit<VendorPaymentSummary, "vendor_name">), vendor_name: names.get(payment.vendor_id) ?? `Vendor #${payment.vendor_id}` },
      allocations: (allocations ?? []).map((row: any) => ({ ...row, purchase_reference: references.get(row.purchase_id) ?? `Purchase #${row.purchase_id}` })) as VendorPaymentAllocationSummary[],
    };
  }
}

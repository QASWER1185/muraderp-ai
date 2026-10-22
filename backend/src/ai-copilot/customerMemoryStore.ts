import { ApiError } from "../errors/api-error.js";
import { getSupabaseAdminClient } from "../config/supabase.js";
import type { AgentScope } from "./agent/erp-tools.js";

export interface CommercialHistoryLine {
  customer_id: number; product_id: number; product_name: string; brand_id: number | null; brand_name: string | null;
  category: string; unit: string; quantity: number; unit_price: number; discount_percent: number; net_unit_price: number;
  invoice_date: string; document_id: number; document_number: string; document_type: "invoice" | "estimate";
  source_item_id: number; currency_code: string;
}
export interface CustomerPricingProfile {
  customerId: number; preferredBrands: Array<{ category: string; brandId: number; brandName: string; purchases: number }>;
  history: CommercialHistoryLine[]; transactionCount: number; averageTransactionVolume: number;
  averageOrderIntervalDays: number | null; context: string;
}
export interface CustomerMemory {
  recall(scope: AgentScope, customerId: number, customerName?: string): Promise<CustomerPricingProfile>;
  latestSale(scope: AgentScope, customerId: number, productId: number, invoiceId?: number): Promise<CommercialHistoryLine>;
  assertFloor(scope: AgentScope, productId: number, listPrice: number, discount: number, unit: string, currency: string, inventoryCost?: number): Promise<void>;
}

/** History is a durable, live projection of ERP transactions, including non-Copilot sales.
 * No process cache, model-authored facts, or duplicate event counters can drift from accounting. */
export class CustomerMemoryStore implements CustomerMemory {
  constructor(private readonly database: () => any = getSupabaseAdminClient) {}
  private async history(scope: AgentScope, customerId: number, productId?: number, invoiceId?: number) {
    const rows: CommercialHistoryLine[] = [];
    for (let offset = 0; ; offset += 500) {
      let query = this.database().from("copilot_commercial_history").select("*")
        .eq("organization_id", scope.organizationId).eq("branch_id", scope.branchId).eq("customer_id", customerId);
      if (productId !== undefined) query = query.eq("product_id", productId).eq("document_type", "invoice");
      if (invoiceId !== undefined) query = query.eq("document_id", invoiceId);
      query = query.order("invoice_date", { ascending: false }).order("document_id", { ascending: false }).order("source_item_id", { ascending: false });
      const { data, error } = await (productId === undefined ? query.range(offset, offset + 499) : query.limit(1));
      if (error) throw new ApiError(502, "CUSTOMER_MEMORY_UNAVAILABLE", "Customer sales history could not be verified.");
      rows.push(...(data ?? []));
      if (productId !== undefined || (data ?? []).length < 500) return rows;
    }
  }
  async recall(scope: AgentScope, customerId: number, customerName = String(customerId)): Promise<CustomerPricingProfile> {
    const history = await this.history(scope, customerId);
    const transactions = new Map<string, { date: string; volume: number }>();
    const brands = new Map<string, { category: string; brandId: number; brandName: string; documents: Set<string> }>();
    for (const row of history) {
      const key = `${row.document_type}:${row.document_id}`;
      const transaction = transactions.get(key) ?? { date: row.invoice_date, volume: 0 };
      transaction.volume += Number(row.quantity) * Number(row.net_unit_price); transactions.set(key, transaction);
      if (row.brand_id != null && row.brand_name) {
        const brandKey = `${row.category}:${row.brand_id}`;
        const brand = brands.get(brandKey) ?? { category: row.category, brandId: row.brand_id, brandName: row.brand_name, documents: new Set<string>() };
        brand.documents.add(key); brands.set(brandKey, brand);
      }
    }
    const preferredBrands = [...brands.values()].map(({ documents, ...brand }) => ({ ...brand, purchases: documents.size }))
      .sort((a, b) => b.purchases - a.purchases || a.brandId - b.brandId)
      .filter((brand, index, all) => all.findIndex(other => other.category === brand.category) === index);
    const dates = [...new Set([...transactions.values()].map(row => row.date))].sort();
    const last = history[0];
    return { customerId, preferredBrands, history, transactionCount: transactions.size,
      averageTransactionVolume: transactions.size ? [...transactions.values()].reduce((sum, row) => sum + row.volume, 0) / transactions.size : 0,
      averageOrderIntervalDays: dates.length < 2 ? null : (Date.parse(dates.at(-1)!) - Date.parse(dates[0]!)) / 86_400_000 / (dates.length - 1),
      context: `[Memory Context]: Customer: ${customerName} | Preferred: ${preferredBrands.map(row => row.category + ": " + row.brandName).join(", ") || "No history"}` +
        (last ? ` | Historical Discount: ${last.discount_percent}% on ${last.brand_name ?? last.product_name} / ${last.category} | Last Order: ${last.invoice_date} (${last.document_number})` : ""),
    };
  }
  async latestSale(scope: AgentScope, customerId: number, productId: number, invoiceId?: number) {
    const row = (await this.history(scope, customerId, productId, invoiceId))[0];
    if (!row) throw new ApiError(422, "RETURN_HISTORY_REQUIRED", "No posted sale for this exact customer and product exists in this branch.");
    return row;
  }
  async assertFloor(scope: AgentScope, productId: number, listPrice: number, discount: number, unit: string, currency: string, inventoryCost?: number) {
    const { data, error } = await this.database().rpc("copilot_purchase_floor", {
      p_organization_id: scope.organizationId, p_product_id: productId, p_list_price: listPrice, p_unit: unit, p_currency: currency,
    });
    if (error) throw new ApiError(502, "PURCHASE_MEMORY_UNAVAILABLE", "Merchant cost floor could not be verified.");
    const stored = data == null ? undefined : Number(data);
    const costs = [stored, inventoryCost].filter((value): value is number => value !== undefined && Number.isFinite(value) && value >= 0);
    if (!costs.length) throw new ApiError(422, "PURCHASE_BASELINE_REQUIRED", "A verified merchant purchase baseline is required before quoting this product.");
    const net = listPrice * (1 - discount / 100);
    if (!Number.isFinite(net) || discount < 0 || discount > 100 || net + 0.0000001 < Math.max(...costs)) {
      throw new ApiError(422, "DISCOUNT_BELOW_COST", "The customer discount would reduce the sale price below the merchant cost floor.");
    }
  }
}

export function rememberedDiscount(profile: CustomerPricingProfile, product: { id: number; brand_id?: number | null; category: string }, unit: string, currency: string,defaultDiscount=0) {
  const compatible = profile.history.filter(row => row.unit === unit && row.currency_code === currency);
  return Number((compatible.find(row => row.product_id === product.id) ??
    compatible.find(row => row.brand_id != null && row.brand_id === product.brand_id && row.category === product.category))?.discount_percent ?? defaultDiscount);
}

export function returnMemoryMessage(customer: string, row: CommercialHistoryLine, credited = false) {
  return `گاہک ${customer} کو یہ سامان ${row.invoice_date} کو انوائس ${row.document_number} کے تحت نیٹ ریٹ ${row.net_unit_price} پر بیچا گیا تھا۔ ` +
    (credited ? "واپسی عین اسی قیمت پر کریڈٹ کی گئی ہے۔" : "منظوری کے بعد واپسی عین اسی قیمت پر کریڈٹ کی جائے گی۔");
}

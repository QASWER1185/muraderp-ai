import { z } from "zod";
import type { PermissionCode } from "../../auth/authorization.types.js";
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text = z.string().trim().min(1).max(200);
const money = z.number().finite().nonnegative();
const percent = z.number().finite().min(0).max(100);
const date = z.iso.date();
export const saleItemSchema = z.strictObject({
  productId: id.optional(), name: text.optional(), size: text.optional(),
  qty: z.number().finite().positive(), unit: z.string().trim().min(1).max(50).optional(),
  rate: money.optional(), discount: percent.optional(), rateListId: id.optional(),
  unitCost: money.optional(),
  rawShorthand: text.optional(),
});
const sale = { customerId: id.optional(), customerName: text.optional(),
  items: z.array(saleItemSchema).min(1), discountScheme: z.strictObject({ percent }).optional() };
export const ERP_ACTION_SCHEMAS = {
  erp_import_rate_list: z.strictObject({ brand: text, category: text, effectiveDate: date,
    items: z.array(z.strictObject({ name: text, size: text, unit: text, list_price: money,
      category: z.enum(["Pipes","Fittings","Hardware"]).optional(), discount: percent })).min(1) }),
  erp_update_product_price: z.strictObject({ productId: id, newPrice: money, reason: z.string().trim().min(1).max(2000), rateListId: id.optional() }),
  erp_create_customer: z.strictObject({ name: text, phone: z.string().trim().max(50), address: text, openingBalance: z.number().finite().default(0), creditLimit: money.default(0) }),
  erp_update_customer: z.strictObject({ customerId: id, updates: z.strictObject({ name: text.optional(), phone: z.string().trim().max(50).optional(), address: text.optional(), creditLimit: money.optional() }) }),
  erp_record_payment: z.strictObject({ customerId: id, amount: z.number().finite().positive(), paymentMethod: z.enum(["CASH","BANK_TRANSFER","CARD","CHEQUE","OTHER"]),
    reference: z.string().trim().max(200).optional(), notes: z.string().trim().max(2000).optional(), paymentDate: date.optional(),
    allocations: z.array(z.strictObject({ invoiceId: id, amount: z.number().finite().positive() })).optional() }),
  erp_create_estimate: z.strictObject(sale),
  erp_customer_return: z.strictObject({ customerId: id, productId: id, qty: z.number().finite().positive(),
    invoiceId: id.optional(), warehouseId: id.optional(), reason: z.string().trim().min(1).max(2000) }),
  erp_convert_estimate_to_invoice: z.strictObject({ estimateId: id, warehouseId: id.optional(),
    unitCosts: z.array(z.strictObject({ productId: id, unitCost: money })).optional() }),
  erp_create_invoice: z.strictObject({ ...sale, customerId: id, discount: percent.optional(), warehouseId: id.optional(), carriageCharges: money.default(0), paidAmount: money.default(0) }),
  erp_get_business_report: z.strictObject({ reportType: z.enum(["daily_sales","customer_balances","low_stock","profit_margin"]),
    dateRange: z.strictObject({ from: date, to: date }).optional(), lowStockThreshold: money.optional() }),
};
export type ErpActionName = keyof typeof ERP_ACTION_SCHEMAS;
export const ERP_ACTION_PERMISSIONS: Record<ErpActionName, PermissionCode> = {
  erp_import_rate_list:"products.write", erp_update_product_price:"products.write",
  erp_create_customer:"customers.write", erp_update_customer:"customers.write",
  erp_record_payment:"payments.create", erp_create_estimate:"sales.create",
  erp_convert_estimate_to_invoice:"sales.create", erp_create_invoice:"sales.create",
  erp_get_business_report:"reports.view",
  erp_customer_return:"returns.create",
};
const descriptions: Record<ErpActionName,string> = {
  erp_import_rate_list:"Prepare the complete brand catalog import with printed prices and per-item discounts; no customer/quantity needed. User approval commits the entire list atomically.",
  erp_update_product_price:"Prepare an audited price change to the product and its authoritative active sale rate version. Ask for the reason and resolve the intended list if ambiguous.",
  erp_create_customer:"Prepare customer creation including address, opening receivable balance and credit limit. Do not invent a phone; an explicitly unknown phone can be empty. Approval posts any opening balance through accounting.",
  erp_update_customer:"Prepare a scoped customer name/phone/address/credit-limit update, preserving existing accounting history.",
  erp_record_payment:"Prepare a customer receipt. Explicit invoice allocations are supported; omitted allocations are clearly previewed as an unallocated advance receipt. Never invent an allocation.",
  erp_create_estimate:"Prepare an entire multi-item estimate in one call, including large demand slips. Resolve names/IDs, use authoritative rates, and show server totals/discounts. No line-count cap. Approval saves the ERP draft.",
  erp_convert_estimate_to_invoice:"Prepare conversion of a persisted active estimate to an invoice, with stock, receivables and accounting. Warehouse is required if more than one exists. Costs come from reconciled movement valuation or explicit reviewed unitCosts; never guess.",
  erp_create_invoice:"Prepare a direct invoice including discounts, carriage and any payment in one atomic transaction. Current sale rates and verified inventory costs are required. Use unitCost only when explicitly provided by the user.",
  erp_get_business_report:"Read a date-bounded authoritative daily sales, customer balances, low-stock or realized profit report. No approval/write is required.",
  erp_customer_return:"Prepare a return bound to this customer's exact historical invoice line and NET billed rate/discount. Never supply prices. Uses the latest posted sale unless the user specifies its invoiceId. Requires approval before credit.",
};
export const ERP_ACTION_DEFINITIONS = Object.entries(ERP_ACTION_SCHEMAS).map(([name,schema]) => ({
  type:"function" as const, name, description:descriptions[name as ErpActionName], strict:false, parameters:z.toJSONSchema(schema),
}));
export function isErpActionName(name:string): name is ErpActionName { return Object.hasOwn(ERP_ACTION_SCHEMAS,name); }
export interface PreparedErpAction {
  tool: Exclude<ErpActionName,"erp_get_business_report">;
  input: Record<string,any>;
  data: Record<string,any>;
  preview: { title:string; summary:string; lines?:unknown[]; totals?:unknown; warnings?:string[] };
}

import { z } from "zod";
import type { PermissionCode } from "../../auth/authorization.types.js";
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text = z.string().trim().min(1).max(200);
const money = z.number().finite().nonnegative();
const percent = z.number().finite().min(0).max(100);
const date = z.iso.date();
export const saleItemSchema = z.strictObject({
  productId: id.optional(), name: text.optional(), size: text.optional(), brand: text.optional(),
  qty: z.number().finite().positive(), unit: z.string().trim().min(1).max(50).optional(),
  rate: money.optional(), discount: percent.optional(), rateListId: id.optional(),
  unitCost: money.optional(),
  rawShorthand: text.optional(),
});
const sale = { customerId: id.optional(), customerName: text.optional(), customerAddress: text.optional(), brand: text.optional(),
  items: z.array(saleItemSchema).min(1).max(500), discountScheme: z.strictObject({ percent }).optional(),
  pricingRules:z.array(z.strictObject({brand:text.optional(),match:text,discount:percent})).max(20).optional() };
const auditLine=z.strictObject({productId:id,name:text,quantity:z.number().finite().positive(),unitPrice:money,discount:percent,specification:text,unitCost:money.optional(),expectedWholesaleDiscount:percent.optional()});
export const DEPOT_ACTION_SCHEMAS={
  erp_amend_estimate:z.strictObject({draftId:z.string().uuid().optional(),addItems:z.array(saleItemSchema).max(500).default([]),removeProductIds:z.array(id).default([]),discountScheme:z.strictObject({percent}).optional(),
    pricingRules:z.array(z.strictObject({brand:text.optional(),match:text,discount:percent})).max(20).optional(),
    updateItems:z.array(saleItemSchema.extend({productId:id})).max(500).optional()}),
  erp_accept_companions:z.strictObject({draftId:z.string().uuid().optional()}),
  erp_create_site:z.strictObject({customerId:id,name:text,address:text}),
  erp_prepare_site_return:z.strictObject({siteId:z.string().uuid(),invoiceId:id,invoiceItemId:id,quantity:z.number().finite().positive()}),
  erp_transfer_site_material:z.strictObject({memoId:z.string().uuid(),targetSiteId:z.string().uuid(),quantity:z.number().finite().positive(),discount:percent.default(0)}),
  erp_deliver_site_transfer:z.strictObject({transferId:z.string().uuid(),warehouseId:id}),
  erp_create_dispatch:z.strictObject({estimateId:id,siteId:z.string().uuid().optional()}),
  erp_record_dispatch:z.strictObject({dispatchId:z.string().uuid(),event:z.enum(["DISPATCH","DELIVER"]),lines:z.array(z.strictObject({lineNumber:id,quantity:z.number().finite().positive()})).min(1).max(500),warehouseId:id.optional()}),
  erp_log_expense:z.strictObject({description:text,amount:z.number().finite().positive(),date,expenseAccountCode:text,cashAccountCode:text,salespersonId:id.optional(),kind:z.enum(["expense","salary"]).default("expense")}),
  erp_update_commodity_rates:z.strictObject({items:z.array(z.strictObject({productId:id,newPrice:money,rateListId:id.optional()})).min(1).max(100),reason:text}),
  erp_reconcile_vendor_quote:z.strictObject({demand:z.array(auditLine).min(1).max(500),vendor:z.array(auditLine).max(500)}),
  erp_correct_vendor_quote:z.strictObject({auditId:z.string().uuid().optional()}),
  erp_find_site_records:z.strictObject({kind:z.enum(["sites","returns","transfers","dispatches"]),customerId:id.optional(),query:text.optional(),limit:z.number().int().min(1).max(50).default(20)}),
  erp_get_dispatch_status:z.strictObject({dispatchId:z.string().uuid()}),
  erp_get_depot_insights:z.strictObject({report:z.enum(["top_sellers","customer_profitability","reorder_deadstock","closing","salesman_roi","credit_guard","accounts"]),from:date.optional(),to:date.optional(),customerId:id.optional()}),
  erp_calculate_landed_cost:z.strictObject({quantity:z.number().finite().positive(),baseUnitCost:money,carriage:money,unloadingPerUnit:money}),
};
export const ERP_ACTION_SCHEMAS = {
  ...DEPOT_ACTION_SCHEMAS,
  erp_import_rate_list: z.strictObject({ brand: text, category: text, effectiveDate: date,
    items: z.array(z.strictObject({ name: text, size: text, unit: text, list_price: money,
      category: z.enum(["Pipes","Fittings","Hardware"]).optional(), discount: percent })).min(1) }),
  erp_update_product_price: z.strictObject({ productId: id, newPrice: money, reason: z.string().trim().min(1).max(2000), rateListId: id.optional() }),
  erp_create_customer: z.strictObject({ name: text, phone: z.string().trim().max(50).nullish(), address: z.string().trim().max(200).nullish(), openingBalance: z.number().finite().default(0), creditLimit: money.default(0) }),
  erp_update_customer: z.strictObject({ customerId: id, updates: z.strictObject({ name: text.optional(), phone: z.string().trim().max(50).optional(), address: text.optional(), creditLimit: money.optional() }) }),
  erp_record_payment: z.strictObject({ customerId: id, amount: z.number().finite().positive(), paymentMethod: z.enum(["CASH","BANK_TRANSFER","CARD","CHEQUE","OTHER"]),
    reference: z.string().trim().max(200).optional(), notes: z.string().trim().max(2000).optional(), paymentDate: date.optional(),
    allocations: z.array(z.strictObject({ invoiceId: id, amount: z.number().finite().positive() })).optional() }),
  erp_create_estimate: z.strictObject(sale),
  erp_customer_return: z.strictObject({ customerId: id, productId: id, qty: z.number().finite().positive(),
    invoiceId: id.optional(), warehouseId: id.optional(), reason: z.string().trim().min(1).max(2000) }),
  erp_convert_estimate_to_invoice: z.strictObject({ estimateId: id, warehouseId: id.optional(),
    paidAmount: money.default(0),
    unitCosts: z.array(z.strictObject({ productId: id, unitCost: money })).optional() }),
  erp_create_invoice: z.strictObject({ ...sale, customerId: id, discount: percent.optional(), warehouseId: id.optional(), carriageCharges: money.default(0), paidAmount: money.default(0) }),
  erp_get_business_report: z.strictObject({ reportType: z.enum(["daily_sales","customer_balances","low_stock","profit_margin"]),
    dateRange: z.strictObject({ from: date, to: date }).optional(), lowStockThreshold: money.optional() }),
};
export type ErpActionName = keyof typeof ERP_ACTION_SCHEMAS;
export type ErpReadName="erp_get_business_report"|"erp_reconcile_vendor_quote"|"erp_correct_vendor_quote"|"erp_get_depot_insights"|"erp_calculate_landed_cost"|"erp_find_site_records"|"erp_get_dispatch_status";
export type ErpWriteName=Exclude<ErpActionName,ErpReadName>;
export const ERP_READ_ACTIONS=new Set<string>(["erp_get_business_report","erp_reconcile_vendor_quote","erp_correct_vendor_quote","erp_get_depot_insights","erp_calculate_landed_cost","erp_find_site_records","erp_get_dispatch_status"]);
export const ERP_ACTION_PERMISSIONS: Record<ErpActionName, PermissionCode> = {
  erp_amend_estimate:"sales.create",erp_accept_companions:"sales.create",erp_create_site:"customers.write",
  erp_prepare_site_return:"returns.create",erp_transfer_site_material:"sales.create",erp_deliver_site_transfer:"sales.create",
  erp_create_dispatch:"sales.create",erp_record_dispatch:"sales.create",erp_log_expense:"accounting.post",erp_update_commodity_rates:"products.write",
  erp_reconcile_vendor_quote:"purchases.read",erp_get_depot_insights:"reports.view",erp_calculate_landed_cost:"purchases.read",
  erp_correct_vendor_quote:"purchases.read",
  erp_find_site_records:"sales.read",erp_get_dispatch_status:"sales.read",
  erp_import_rate_list:"products.write", erp_update_product_price:"products.write",
  erp_create_customer:"customers.write", erp_update_customer:"customers.write",
  erp_record_payment:"payments.create", erp_create_estimate:"sales.create",
  erp_convert_estimate_to_invoice:"sales.create", erp_create_invoice:"sales.create",
  erp_get_business_report:"reports.view",
  erp_customer_return:"returns.create",
};
const descriptions: Record<ErpActionName,string> = {
  erp_amend_estimate:"Amend the current unconfirmed estimate while retaining customer, brand and every slip line. Use pricingRules for category/brand discounts (pipe 50%, fittings 52%), updateItems for quantity/discount corrections by resolved productId, addItems for additions, removeProductIds for removals. Omit draftId to use working context. Recalculates one fresh preview, no posting.",
  erp_accept_companions:"After the merchant explicitly asks to include suggested installation companions (ہاں ڈال دو), prepare a fresh estimate with them. Omit draftId for working context. No prices, sizes or alternative brands may be invented; ambiguous catalog matches require clarification.",
  erp_create_site:"Prepare a named customer sub-project/site with address.",
  erp_prepare_site_return:"Prepare a pending-pickup site return memo bound to the exact historical invoice item NET rate. It is a reservation, not yet a credit or warehouse receipt.",
  erp_transfer_site_material:"Allocate uncollected material from a site-return memo to another site of the same customer. Prepare current catalog-rate target estimate and a rate-free transfer challan. Credit/invoice post only at delivery.",
  erp_deliver_site_transfer:"Confirm physical inter-site delivery. Atomically credit the source at original NET billed price/cost and bill the destination at approved active rate; use a verified transit warehouse.",
  erp_create_dispatch:"Prepare a rate-free loading/picking challan for a persisted estimate, optionally tagged to a customer site. Does not invoice, reduce stock or change estimate totals.",
  erp_record_dispatch:"Prepare a partial dispatch or delivery event. Track quantities without changing estimate totals. When all quantities are delivered, require verified warehouse/costs and atomically post the final sales invoice.",
  erp_log_expense:"Prepare a described cash/bank expense or salesman salary. Read accounts first, select existing expense and asset account codes. Approval posts a balanced journal.",
  erp_update_commodity_rates:"Prepare current Cement/Wire or other product rate overrides without PDF. Use resolved product IDs and catalog list; approval creates audited active rate versions atomically.",
  erp_reconcile_vendor_quote:"Compare merchant-provided customer demand against vendor quote observations. Highlight quantity/spec downgrades, wholesale discount errors and negative margins. Return corrected proposal for merchant review; no purchase is posted.",
  erp_correct_vendor_quote:"Show the corrected vendor-quote proposal from the current audit (اسے ٹھیک کر دو). Uses workingAuditId when auditId is omitted. Never posts a supplier bill or silently changes a wholesale agreement.",
  erp_find_site_records:"Resolve scoped site names, return memos, planned transfers or dispatch records before using their IDs. Customer and name filters are supported.",
  erp_get_dispatch_status:"Read exact planned, dispatched, delivered and pending quantities for one scoped dispatch order.",
  erp_get_depot_insights:"Read scoped top-sellers, customer profitability, reorder/dead stock >60d, evening cash/udhaar closing, expense leaks/salesman salary ROI, credit aging or available account codes.",
  erp_calculate_landed_cost:"Calculate base purchase cost + carriage + unloading per unit from explicit merchant inputs; no write.",
  erp_import_rate_list:"Prepare validated priced catalog rows for import, omitting blank or unreadable rates with review warnings; no customer/quantity needed. User approval commits the previewed rows atomically.",
  erp_update_product_price:"Prepare an audited price change to the product and its authoritative active sale rate version. Ask for the reason and resolve the intended list if ambiguous.",
  erp_create_customer:"Prepare customer creation including address, opening receivable balance and credit limit. Do not invent a phone; an explicitly unknown phone can be empty. Approval posts any opening balance through accounting.",
  erp_update_customer:"Prepare a scoped customer name/phone/address/credit-limit update, preserving existing accounting history.",
  erp_record_payment:"Prepare a customer receipt. Explicit invoice allocations are supported; omitted allocations are clearly previewed as an unallocated advance receipt. Never invent an allocation.",
  erp_create_estimate:"Prepare ALL slip items in one estimate using active Rate List prices. Estimates NEVER require stock, a warehouse or inventory costs. Pass an explicit brand as a HARD filter. Supply customerName and customerAddress when new: one approval creates the customer and saves the estimate atomically; no separate customer creation or phone question.",
  erp_convert_estimate_to_invoice:"Prepare conversion of a persisted active estimate to an invoice, with stock, receivables and accounting. Warehouse is required if more than one exists. Costs come from reconciled movement valuation or explicit reviewed unitCosts; never guess.",
  erp_create_invoice:"Prepare a direct invoice including discounts, carriage and any payment in one atomic transaction. Current sale rates and verified inventory costs are required. Use unitCost only when explicitly provided by the user.",
  erp_get_business_report:"Read a date-bounded authoritative daily sales, customer balances, low-stock or realized profit report. No approval/write is required.",
  erp_customer_return:"Prepare a return bound to this customer's exact historical invoice line and NET billed rate/discount. Never supply prices. The server asks for invoiceId when historical rates differ; pass the owner's chosen source invoice on follow-up. Requires approval before credit and stock restoration.",
};
export const ERP_ACTION_DEFINITIONS = Object.entries(ERP_ACTION_SCHEMAS).map(([name,schema]) => ({
  type:"function" as const, name, description:descriptions[name as ErpActionName], strict:false, parameters:z.toJSONSchema(schema),
}));
export function isErpActionName(name:string): name is ErpActionName { return Object.hasOwn(ERP_ACTION_SCHEMAS,name); }
export interface PreparedErpAction {
  tool: ErpWriteName;
  input: Record<string,any>;
  data: Record<string,any>;
  preview: { title:string; summary:string; lines?:unknown[]; totals?:unknown; warnings?:string[]; incomplete?:boolean; partialTotals?:unknown;
    companions?:unknown[];quotation?:unknown;privateMargin?:unknown;challan?:unknown;audit?:unknown };
}

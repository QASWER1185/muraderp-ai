import { vi } from "vitest";
import { TenantAccessService } from "../../auth/tenant-access.service.js";
import { ApiError } from "../../errors/api-error.js";
import { resolveCandidates } from "../../services/entity-search.service.js";
import type { ResolvedPrice } from "../../types/pricing.types.js";
import type { CustomerLedger } from "../../repositories/copilot-business.repository.js";
import type { BusinessServices } from "./business-tools.js";
import { UnifiedCopilotAgent } from "./agent.js";
import { ErpToolRegistry } from "./erp-tools.js";
import { newBusinessState } from "./business-state.js";
import { fixture, pipe, elbow, customer, scope } from "./stateful.test-fixtures.js";

export { call, final, scope, pipe, elbow, customer } from "./stateful.test-fixtures.js";
export const dura = { ...pipe, id: 32, name: "DURA PIPE PN20 25MM", sku: "DURA-32" };
export const third = { ...pipe, id: 33, name: "THIRD PIPE PN20 25MM", sku: "THIRD-33" };
export const vendor = { id: 8, name: "Popular supplier" };
export const customerPayment = { customer_id: customer.id, amount: 200, payment_date: "2026-10-05", currency_code: "PKR", payment_method: "CASH" as const, allocations: [{ invoice_id: 501, amount: 200 }] };
export const vendorPayment = { vendor_id: vendor.id, amount: 200, payment_date: "2026-10-05", payment_method: "BANK" as const, allocations: [{ purchase_id: 601, amount: 200 }] };
export const ledger: CustomerLedger = {
  balances: [{ currency_code: "PKR", debit: 1000, credit: 200, outstanding: 800 }],
  transactions: [{ id: 2, date: "2026-10-04", entryType: "PAYMENT", referenceType: "CUSTOMER_PAYMENT", referenceId: 701,
    debit: 0, credit: 200, currencyCode: "PKR", description: "Receipt", journals: [{ id: "55555555-5555-4555-8555-555555555555", date: "2026-10-04", sourceType: "CUSTOMER_PAYMENT", status: "POSTED" }] }],
  latestPayment: { id: 2, date: "2026-10-04", amount: 200, currencyCode: "PKR", referenceId: 701 }, nextCursor: 2,
};
export function businessFixture() {
  const f = fixture();
  const gateway = {
    isOrganizationMember: vi.fn(async (user: string, org: string) => user === scope.userId && org === scope.organizationId),
    hasPermission: vi.fn(async () => true),
    hasBranchAccess: vi.fn(async (_user: string, _org: string, branch: string) => branch === scope.branchId),
  };
  f.services.tenant = new TenantAccessService(gateway);
  const products = [pipe, dura, third, elbow];
  vi.mocked(f.services.erp.getProduct).mockImplementation(async (id, org) => org === scope.organizationId ? products.find(row => row.id === id) as any ?? null : null);
  vi.mocked(f.services.search.searchProducts).mockImplementation(async query => resolveCandidates([
    products.find(row => query.toLowerCase().includes("dura") ? row.id === dura.id : query.toLowerCase().includes("third") ? row.id === third.id : query.toLowerCase().includes("elbow") ? row.id === elbow.id : row.id === pipe.id)!,
  ].map(row => ({ ...row, category: "Pipe", brandName: row.id === dura.id ? "Dura" : "Popular", confidence: 1, match_kind: "exact_name" })), 5));
  const sale = new Map([[pipe.id, 500], [dura.id, 450], [third.id, 600], [elbow.id, 200]]);
  const cost = new Map([[pipe.id, 300], [dura.id, 315], [third.id, 300], [elbow.id, 100]]);
  vi.mocked(f.services.pricing.resolvePrice).mockImplementation(async input => ({ product_id: input.product_id,
    unit_price: (input.price_type === "SALE" ? sale : cost).get(input.product_id)!, unit: products.find(row => row.id === input.product_id)!.unit,
    currency_code: "PKR", rate_list_id: 4, rate_list_version_id: 10, rate_list_item_id: input.product_id,
    minimum_quantity: 1, effective_from: "2026-01-01", scope_type: "GLOBAL" } satisfies ResolvedPrice));
  const services: BusinessServices = {
    repository: {
      customerLedger: vi.fn(async (context, id) => {
        if (context.organizationId !== scope.organizationId || context.branchId !== scope.branchId || id !== customer.id) throw new ApiError(403,"DENIED","Denied");
        return structuredClone(ledger);
      }),
      searchVendors: vi.fn(async () => resolveCandidates([{ ...vendor, confidence: 1, match_kind: "exact_name" }], 5)),
    },
    erp: {
      getVendor: vi.fn(async (id, org) => id === vendor.id && org === scope.organizationId ? vendor as any : null),
      getWarehouse: vi.fn(async (id, org) => id === 1 && org === scope.organizationId ? { id, name: "Main" } as any : null),
      listInventory: vi.fn(async (page, org) => ({ data: org === scope.organizationId ? [{ id: 1, organization_id: org, product_id: page.product_id, warehouse_id: 1, quantity: page.product_id === dura.id ? 30 : 100 }] as any : [], next_cursor: null })),
      listStockMovements: vi.fn(async (page, org, branch) => ({ data: org === scope.organizationId && branch === scope.branchId ? [{ id: 5, warehouse_id: 1, movement_type: "PURCHASE", product_id: page.product_id, quantity: 100, created_at: "2026-10-01", reference_type: "PURCHASE", reference_id: 601 }] as any : [], next_cursor: null })),
    },
    customers: { listReceivables: vi.fn(async (org, branch, _limit, _cursor, filter) => ({ data: org === scope.organizationId && branch === scope.branchId && filter?.customerId === customer.id && (!filter.invoiceIds || filter.invoiceIds.includes(501)) ? [{ invoice_id: 501, customer_id: customer.id, customer_name: customer.name, invoice_number: "INV-501", status: "POSTED", currency_code: "PKR", invoice_total: 1000, paid: 200, credited: 0, outstanding: 800 }] : [], next_cursor: null })) },
    vendors: { listPayables: vi.fn(async (org, branch, _limit, _cursor, filter) => ({ data: org === scope.organizationId && branch === scope.branchId && filter?.vendorId === vendor.id && (!filter.purchaseIds || filter.purchaseIds.includes(601)) ? [{ purchase_id: 601, vendor_id: vendor.id, vendor_name: vendor.name, purchase_date: "2026-10-01", invoice_number: "P-601", total: 1000, paid: 100, outstanding: 900 }] : [], next_cursor: null })) },
  };
  const tools = new ErpToolRegistry(f.services, true, services);
  const core = new UnifiedCopilotAgent({ respond: f.respond }, tools);
  const state = newBusinessState(scope);
  state.customer = customer; state.vendor = vendor; state.productContext = { candidates: [{ id: pipe.id, name: pipe.name, unit: pipe.unit, sku: pipe.sku }], ambiguous: false };
  return { ...f, tools, core, business: services, state, gateway, sale, cost };
}

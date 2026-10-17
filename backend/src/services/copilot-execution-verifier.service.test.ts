import { describe, expect, it, vi } from "vitest";
import { DefaultCopilotExecutionVerifier } from "./copilot-execution-verifier.service.js";
import type { CopilotActionPlan } from "../ai-copilot/copilot.types.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "33333333-3333-4333-8333-333333333333";
const base: CopilotActionPlan = {
  organizationId, branchId, userId: "22222222-2222-4222-8222-222222222222",
  source: "text", target: "estimate", lines: [], requiresConfirmation: true,
};

function verifier(overrides: Record<string, unknown>) {
  const reads = {
    erp: { getCustomer: vi.fn(), getVendor: vi.fn(), getPurchase: vi.fn() },
    estimates: { getEstimateAggregate: vi.fn() },
    customerPayments: { getPayment: vi.fn() },
    vendorPayments: { getPayment: vi.fn() },
    returns: { getById: vi.fn() },
    rateLists: { getRateList: vi.fn(), listVersions: vi.fn(), listItems: vi.fn() },
    ...overrides,
  };
  return { reads, service: new DefaultCopilotExecutionVerifier(reads as any) };
}

describe("independent ERP result comparison", () => {
  it("checks persisted estimate header and priced lines against the execution result", async () => {
    const line = { line_number: 1, product_id: 501, quantity: 20, unit: "bag", unit_price: 1525 };
    const result = { id: 7001, status: "DRAFT", definition: { estimate_number: "EST-1" }, lines: [line] };
    const aggregate = { record: { id: 7001, organization_id: organizationId, branch_id: branchId, customer_id: 101, estimate_number: "EST-1", status: "DRAFT" }, items: [line] };
    const { service, reads } = verifier({ estimates: { getEstimateAggregate: vi.fn().mockResolvedValue(aggregate) } });
    const plan: CopilotActionPlan = { ...base, customerId: "101", lines: [{ productName: "Cement", productId: 501, quantity: 20, rateSource: "EXPLICIT_USER_RATE" }] };
    await service.verify(plan, result);
    expect(reads.estimates.getEstimateAggregate).toHaveBeenCalledWith(7001, organizationId);
    aggregate.items = [{ ...line, quantity: 21 }];
    await expect(service.verify(plan, result)).rejects.toThrow("Estimate lines differ");
  });

  it("checks persisted purchase items through the ERP purchase read path", async () => {
    const purchase = { id: 71, vendor_id: 8, warehouse_id: 3, total: 300 };
    const item = { product_id: 9, quantity: 2, unit_cost: 150 };
    const getPurchase = vi.fn().mockResolvedValue({ purchase, items: [item] });
    const { service } = verifier({ erp: { getPurchase } });
    const plan: CopilotActionPlan = { ...base, target: "supplier_bill", vendorId: "8", warehouseId: 3, lines: [{ productName: "Pipe", productId: 9, quantity: 2, rateSource: "EXPLICIT_USER_RATE" }] };
    await service.verify(plan, { purchase, items: [item] });
    expect(getPurchase).toHaveBeenCalledWith(71, organizationId, branchId);
    getPurchase.mockResolvedValueOnce({ purchase, items: [{ ...item, quantity: 1 }] });
    await expect(service.verify(plan, { purchase, items: [item] })).rejects.toThrow("Purchase lines differ");
  });

  it("checks customer and vendor payments with their scoped payment reads", async () => {
    const customerInput = { customer_id: 5, payment_date: "2026-09-11", amount: 100, currency_code: "PKR", payment_method: "CASH" as const, allocations: [{ invoice_id: 50, amount: 100 }] };
    const customerPayment = { id: 91, ...customerInput };
    const customerRead = vi.fn().mockResolvedValue({ payment: customerPayment, allocations: [{ payment_id: 91, invoice_id: 50, amount: 100 }] });
    const vendorInput = { vendor_id: 6, payment_date: "2026-09-11", amount: 200, payment_method: "BANK" as const, allocations: [{ purchase_id: 60, amount: 200 }] };
    const vendorRead = vi.fn().mockResolvedValue({ payment: { id: 92, ...vendorInput }, allocations: [{ payment_id: 92, purchase_id: 60, amount: 200 }] });
    const { service } = verifier({ customerPayments: { getPayment: customerRead }, vendorPayments: { getPayment: vendorRead } });
    await service.verify({ ...base, target: "customer_payment", customerPaymentData: customerInput }, { payment: customerPayment, allocations: customerInput.allocations });
    await service.verify({ ...base, target: "vendor_payment", vendorPaymentData: vendorInput }, 92);
    expect(customerRead).toHaveBeenCalledWith(organizationId, branchId, 91);
    expect(vendorRead).toHaveBeenCalledWith(organizationId, branchId, 92);
    vendorRead.mockResolvedValueOnce({ payment: { id: 92, ...vendorInput }, allocations: [] });
    await expect(service.verify({ ...base, target: "vendor_payment", vendorPaymentData: vendorInput }, 92)).rejects.toThrow("Payment allocations count differs");
  });

  it("checks the persisted customer return and its source items", async () => {
    const credit_note = { id: 93, invoice_id: 81, customer_id: 5, status: "POSTED" };
    const item = { invoice_item_id: 82, warehouse_id: 3, quantity: 2 };
    const getById = vi.fn().mockResolvedValue({ credit_note, items: [item] });
    const { service } = verifier({ returns: { getById } });
    const plan: CopilotActionPlan = { ...base, target: "customer_return", customerId: "5", documentNumber: "81", warehouseId: 3, lines: [{ productName: "Pipe", productId: 9, sourceItemId: 82, quantity: 2, rateSource: "UNRESOLVED" }] };
    await service.verify(plan, { credit_note, items: [item] });
    expect(getById).toHaveBeenCalledWith(organizationId, branchId, 93);
  });
});

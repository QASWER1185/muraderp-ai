import type { CopilotActionPlan } from "../ai-copilot/copilot.types.js";
import type { ErpService } from "./erp.service.js";
import type { EstimateCloneRepriceRepository } from "./estimate-clone-reprice.service.js";
import type { CustomerPaymentBrowserRepository } from "../repositories/customer-payment-browser.repository.js";
import type { VendorPaymentBrowserRepository } from "../repositories/vendor-payment-browser.repository.js";
import type { SalesReturnBrowserRepository } from "../repositories/sales-return-browser.repository.js";
import type { SupabaseRateListRepository } from "../repositories/rate-list.repository.js";

export interface CopilotExecutionVerifier {
  verify(plan: CopilotActionPlan, executionResult: unknown): Promise<void>;
}

export interface CopilotVerificationReaders {
  erp: Pick<ErpService, "getCustomer" | "getVendor" | "getPurchase">;
  estimates: Pick<EstimateCloneRepriceRepository, "getEstimateAggregate">;
  customerPayments: Pick<CustomerPaymentBrowserRepository, "getPayment">;
  vendorPayments: Pick<VendorPaymentBrowserRepository, "getPayment">;
  returns: Pick<SalesReturnBrowserRepository, "getById">;
  rateLists: Pick<SupabaseRateListRepository, "getRateList" | "listVersions" | "listItems">;
}

function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is missing`);
  return value as Record<string, any>;
}

function positiveId(value: unknown, label: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} has no valid persisted ID`);
  return id;
}

function same(label: string, actual: unknown, expected: unknown): void {
  if (typeof expected === "number" && Number.isFinite(expected)) {
    if (!Number.isFinite(Number(actual)) || Math.abs(Number(actual) - expected) > 0.000001) throw new Error(`${label} differs from the approved execution`);
    return;
  }
  if (actual !== expected) throw new Error(`${label} differs from the approved execution`);
}

function sameLines(label: string, actual: unknown, expected: unknown, fields: string[]): void {
  if (!Array.isArray(actual) || !Array.isArray(expected)) throw new Error(`${label} are missing`);
  if (actual.length !== expected.length) throw new Error(`${label} count differs from the approved execution`);
  const key = (line: unknown) => {
    const row = record(line, label);
    return JSON.stringify(fields.map((field) => row[field] === undefined ? null : typeof row[field] === "number" ? row[field] : Number.isFinite(Number(row[field])) && row[field] !== "" ? Number(row[field]) : row[field]));
  };
  const actualKeys = actual.map(key).sort();
  const expectedKeys = expected.map(key).sort();
  if (actualKeys.some((value, index) => value !== expectedKeys[index])) throw new Error(`${label} differs from the approved execution`);
}

function branch(plan: CopilotActionPlan): string {
  if (!plan.branchId) throw new Error("Approved action has no branch context");
  return plan.branchId;
}

/** Re-reads persisted business records through the same scoped read paths used by ERP screens. */
export class DefaultCopilotExecutionVerifier implements CopilotExecutionVerifier {
  constructor(private readonly readers: CopilotVerificationReaders) {}

  async verify(plan: CopilotActionPlan, executionResult: unknown): Promise<void> {
    const result = plan.target === "vendor_payment" ? {} : record(executionResult, "Execution result");
    const organizationId = plan.organizationId;

    if (plan.target === "customer_create" || plan.target === "vendor_create") {
      const id = positiveId(result.id, "Created master record");
      const expected = plan.target === "customer_create" ? plan.customerData : plan.vendorData;
      if (!expected) throw new Error("Approved master record details are missing");
      const persisted = plan.target === "customer_create"
        ? await this.readers.erp.getCustomer(id, organizationId)
        : await this.readers.erp.getVendor(id, organizationId);
      if (!persisted) throw new Error("Created master record was not found on independent read");
      same("Master record ID", persisted.id, id);
      for (const field of ["name", "phone", "city"] as const) {
        same(`Master record ${field}`, persisted[field], expected[field]);
        same(`Execution result ${field}`, result[field], persisted[field]);
      }
      return;
    }

    if (plan.target === "estimate") {
      const id = positiveId(result.id, "Estimate");
      const persisted = await this.readers.estimates.getEstimateAggregate(id, organizationId);
      if (!persisted) throw new Error("Estimate was not found on independent read");
      same("Estimate ID", persisted.record.id, id);
      same("Estimate organization", persisted.record.organization_id, organizationId);
      same("Estimate branch", persisted.record.branch_id, branch(plan));
      same("Estimate customer", persisted.record.customer_id, positiveId(plan.customerId, "Customer"));
      same("Estimate status", persisted.record.status, result.status);
      same("Estimate number", persisted.record.estimate_number, record(result.definition, "Estimate definition").estimate_number);
      const executedLines = result.lines;
      if (!Array.isArray(executedLines)) throw new Error("Estimate execution lines are missing");
      sameLines("Estimate lines", persisted.items, executedLines, ["line_number", "product_id", "quantity", "unit", "unit_price"]);
      sameLines("Approved estimate products", persisted.items, plan.lines.map((line, index) => ({ line_number: index + 1, product_id: line.productId, quantity: line.quantity })), ["line_number", "product_id", "quantity"]);
      return;
    }

    if (plan.target === "supplier_bill") {
      const executed = record(result.purchase, "Purchase execution result");
      const id = positiveId(executed.id, "Purchase");
      const persisted = await this.readers.erp.getPurchase(id, organizationId, branch(plan));
      if (!persisted) throw new Error("Purchase was not found on independent read");
      same("Purchase ID", persisted.purchase.id, id);
      same("Purchase vendor", persisted.purchase.vendor_id, positiveId(plan.vendorId, "Vendor"));
      same("Purchase warehouse", persisted.purchase.warehouse_id, plan.warehouseId);
      same("Purchase total", persisted.purchase.total, executed.total);
      sameLines("Purchase lines", persisted.items, result.items, ["product_id", "quantity", "unit_cost"]);
      sameLines("Approved purchase products", persisted.items, plan.lines.map((line) => ({ product_id: line.productId, quantity: line.quantity })), ["product_id", "quantity"]);
      return;
    }

    if (plan.target === "customer_payment" || plan.target === "vendor_payment") {
      const customer = plan.target === "customer_payment";
      const input = customer ? plan.customerPaymentData : plan.vendorPaymentData;
      if (!input) throw new Error("Approved payment details are missing");
      const executedId = positiveId(customer ? record(result.payment, "Payment result").id : executionResult, "Payment");
      const persisted = customer
        ? await this.readers.customerPayments.getPayment(organizationId, branch(plan), executedId)
        : await this.readers.vendorPayments.getPayment(organizationId, branch(plan), executedId);
      if (!persisted) throw new Error("Payment was not found on independent read");
      const payment = persisted.payment as unknown as Record<string, unknown>;
      same("Payment ID", persisted.payment.id, executedId);
      same("Payment party", customer ? payment.customer_id : payment.vendor_id, customer ? plan.customerPaymentData!.customer_id : plan.vendorPaymentData!.vendor_id);
      same("Payment amount", persisted.payment.amount, input.amount);
      same("Payment date", persisted.payment.payment_date, input.payment_date);
      same("Payment method", persisted.payment.payment_method, input.payment_method);
      if (customer) same("Payment currency", (persisted.payment as { currency_code?: string }).currency_code, plan.customerPaymentData!.currency_code);
      sameLines("Payment allocations", persisted.allocations, input.allocations, customer ? ["invoice_id", "amount"] : ["purchase_id", "amount"]);
      if (customer) sameLines("Execution payment allocations", persisted.allocations, result.allocations, ["invoice_id", "amount"]);
      return;
    }

    if (plan.target === "customer_return") {
      const executed = record(result.credit_note, "Return execution result");
      const id = positiveId(executed.id, "Return");
      const persisted = await this.readers.returns.getById(organizationId, branch(plan), id);
      if (!persisted) throw new Error("Return was not found on independent read");
      same("Return ID", persisted.credit_note.id, id);
      same("Return invoice", persisted.credit_note.invoice_id, positiveId(plan.documentNumber, "Source invoice"));
      same("Return customer", persisted.credit_note.customer_id, positiveId(plan.customerId, "Customer"));
      same("Return status", persisted.credit_note.status, executed.status);
      sameLines("Return lines", persisted.items, result.items, ["invoice_item_id", "warehouse_id", "quantity"]);
      sameLines("Approved return lines", persisted.items, plan.lines.map((line) => ({ invoice_item_id: line.sourceItemId, warehouse_id: plan.warehouseId, quantity: line.quantity })), ["invoice_item_id", "warehouse_id", "quantity"]);
      return;
    }

    if (plan.target === "rate_list_update") {
      const executed = record(result.version, "Version execution result");
      const versionId = positiveId(executed.id, "Version");
      const target = plan.rateListUpdate;
      const targetId = target?.rateListId;
      if (!target || !targetId || !await this.readers.rateLists.getRateList(targetId, organizationId)) throw new Error("Approved target was not found on independent read");
      const versions = await this.readers.rateLists.listVersions(targetId);
      const persisted = versions.find((version) => version.id === versionId);
      if (!persisted) throw new Error("Created version was not found on independent read");
      same("Version target", persisted.rate_list_id, targetId);
      same("Version number", persisted.version_number, target.versionNumber);
      same("Version status", persisted.status, "DRAFT");
      const items = await this.readers.rateLists.listItems([versionId]);
      sameLines("Version items", items, result.items, ["product_id", "minimum_quantity", "unit_price", "unit"]);
      sameLines("Approved version products", items, plan.lines.map((line) => ({ product_id: line.productId, minimum_quantity: line.quantity, unit_price: line.explicitUnitRate, unit: line.unit })), ["product_id", "minimum_quantity", "unit_price", "unit"]);
      return;
    }

    throw new Error(`Independent verification is unavailable for ${plan.target}`);
  }
}

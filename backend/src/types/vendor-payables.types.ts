export type VendorPaymentMethod = "CASH" | "BANK" | "OTHER";

export interface VendorPaymentAllocationInput {
  purchaseId: number;
  amount: number;
}

export interface VendorPaymentInput {
  vendorId: number;
  amount: number;
  paymentMethod: VendorPaymentMethod;
  allocations: VendorPaymentAllocationInput[];
  paymentDate?: string;
  reference?: string;
  notes?: string;
}

export interface VendorPaymentIdempotencyContext {
  principalScope: string;
  idempotencyKey: string;
  requestFingerprint: string;
}

export interface VendorPaymentResult {
  paymentId: number;
}

export function validateVendorPaymentInput(input: VendorPaymentInput): void {
  if (!Number.isInteger(input.vendorId) || input.vendorId <= 0) throw new Error("vendorId must be a positive integer");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("amount must be greater than zero");
  if (!input.allocations.length) throw new Error("at least one allocation is required");
  const allocated = input.allocations.reduce((sum, allocation) => {
    if (!Number.isInteger(allocation.purchaseId) || allocation.purchaseId <= 0) throw new Error("purchaseId must be a positive integer");
    if (!Number.isFinite(allocation.amount) || allocation.amount <= 0) throw new Error("allocation amount must be greater than zero");
    return sum + allocation.amount;
  }, 0);
  if (Math.abs(allocated - input.amount) > 0.000001) throw new Error("allocated amount must equal payment amount");
}

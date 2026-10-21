import { z } from "zod";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const amount = z.number().finite().positive().max(1_000_000_000)
  .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, "Use at most two decimal places");
export const paymentDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "A real calendar date is required");
const common = { payment_date: paymentDate, amount, notes: z.string().trim().min(1).max(500).optional() };
export const customerPaymentSchema = z.strictObject({
  ...common, customer_id: id, currency_code: z.string().regex(/^[A-Z]{3}$/),
  payment_method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "CHEQUE", "OTHER"]),
  reference_number: z.string().trim().min(1).max(200).optional(),
  allocations: z.array(z.strictObject({ invoice_id: id, amount })).min(1).max(20),
});
export const vendorPaymentSchema = z.strictObject({
  ...common, vendor_id: id, payment_method: z.enum(["CASH", "BANK", "OTHER"]),
  reference: z.string().trim().min(1).max(200).optional(),
  allocations: z.array(z.strictObject({ purchase_id: id, amount })).min(1).max(20),
});
export const paymentStateSchema = z.discriminatedUnion("intent", [
  z.strictObject({ intent: z.literal("customer_payment"), partyName: z.string().max(160), payment: customerPaymentSchema }),
  z.strictObject({ intent: z.literal("vendor_payment"), partyName: z.string().max(160), payment: vendorPaymentSchema }),
]);
export type PaymentPreparation = z.infer<typeof paymentStateSchema>;

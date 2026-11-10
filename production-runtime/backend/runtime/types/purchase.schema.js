import { z } from 'zod';
export const purchaseSchema = z.strictObject({
    vendor_id: z.number().int().positive(),
    warehouse_id: z.number().int().positive(),
    items: z.array(z.strictObject({ product_id: z.number().int().positive(), quantity: z.number().finite().positive(), unit_cost: z.number().finite().positive() })).min(1).max(500),
    purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    invoice_number: z.string().trim().min(1).max(100).optional(),
    discount: z.number().finite().nonnegative().optional(),
    tax: z.number().finite().nonnegative().optional(),
    notes: z.string().trim().min(1).max(2_000).optional(),
});
//# sourceMappingURL=purchase.schema.js.map
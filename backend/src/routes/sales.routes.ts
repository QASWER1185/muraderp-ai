import { Router } from "express";
import { z } from "zod";
import { createInternalApiAuth } from "../middleware/internal-api-auth.js";
import { SalesTransactionService } from "../services/sales-transaction.service.js";
import { SupabaseSalesTransactionRepository } from "../repositories/sales-transaction.repository.js";

const id = z.coerce.number().int().positive();
const lineSchema = z.strictObject({
  line_number: id,
  product_id: id,
  quantity: z.number().finite().positive(),
  unit: z.string().trim().min(1).max(50),
  unit_price: z.number().finite().nonnegative(),
  line_total: z.number().finite().nonnegative(),
  unit_cost: z.number().finite().nonnegative().nullable(),
  cogs_total: z.number().finite().nonnegative().nullable(),
});
const invoiceSchema = z.strictObject({
  id: z.literal(0),
  status: z.literal("DRAFT"),
  source_estimate_id: id.nullable(),
  source_type: z.enum(["DIRECT", "FROM_ESTIMATE"]),
  definition: z.strictObject({
    invoice_number: z.string().trim().min(1).max(100),
    customer_id: id,
    salesperson_id: id.nullable().optional(),
    issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency_code: z.string().trim().min(1).max(10),
    notes: z.string().trim().max(2_000).nullable().optional(),
  }),
  lines: z.array(z.any()),
  subtotal: z.number().finite().nonnegative(),
  discount_total: z.number().finite().nonnegative(),
  grand_total: z.number().finite().nonnegative(),
  pass_through_rent: z.number().finite().nonnegative(),
});
const requestSchema = z.strictObject({ invoice: invoiceSchema, warehouse_id: id, lines: z.array(lineSchema).min(1).max(500) });

export function createSalesRouter(internalApiToken: string | undefined, principalId: string | undefined): Router {
  const router = Router();
  const authorize = createInternalApiAuth(internalApiToken);
  const service = principalId ? new SalesTransactionService(new SupabaseSalesTransactionRepository(principalId)) : null;

  router.post("/invoices", authorize, async (request, response) => {
    if (!service) {
      response.status(503).json({ error: { code: "ERP_NOT_CONFIGURED", message: "Sales transaction principal is not configured" } });
      return;
    }
    const idempotencyKey = request.header("Idempotency-Key")?.trim();
    if (!idempotencyKey) {
      response.status(400).json({ error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Idempotency-Key header is required" } });
      return;
    }
    const body = requestSchema.parse(request.body);
    const normalized = {
      ...body,
      invoice: {
        ...body.invoice,
        definition: {
          ...body.invoice.definition,
          salesperson_id: body.invoice.definition.salesperson_id ?? null,
          notes: body.invoice.definition.notes ?? null,
        },
      },
      idempotency_key: idempotencyKey,
    };
    const result = await service.createInvoice(normalized);
    response.status(201).json({ success: true, data: result });
  });
  return router;
}

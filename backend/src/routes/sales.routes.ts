import { Router, type Request } from "express";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import { createInternalApiAuth } from "../middleware/internal-api-auth.js";
import { requireServicePrincipal } from "../security/service-principal.js";
import { SalesTransactionService } from "../services/sales-transaction.service.js";
import { SupabaseSalesTransactionRepository } from "../repositories/sales-transaction.repository.js";

const id = z.coerce.number().int().positive();
const uuid = z.string().uuid();
const lineSchema = z.strictObject({
  line_number: id,
  product_id: id,
  quantity: z.number().finite().positive(),
  unit: z.string().trim().min(1).max(50),
  unit_price: z.number().finite().nonnegative(),
  line_total: z.number().finite().nonnegative(),
  unit_cost: z.number().finite().nonnegative(),
  cogs_total: z.number().finite().nonnegative(),
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
  grand_total: z.number().finite().positive(),
  pass_through_rent: z.number().finite().nonnegative(),
});
const requestSchema = z.strictObject({ invoice: invoiceSchema, warehouse_id: id, lines: z.array(lineSchema).min(1).max(500) });

function requiredUuidHeader(request: Request, name: string): string {
  const value = request.header(name)?.trim();
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "TENANT_CONTEXT_REQUIRED", `${name} must be a valid UUID`);
  return parsed.data;
}

function optionalUuidHeader(request: Request, name: string): string | null {
  const value = request.header(name)?.trim();
  if (!value) return null;
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "TENANT_CONTEXT_INVALID", `${name} must be a valid UUID when provided`);
  return parsed.data;
}

export function createSalesRouter(internalApiToken: string | undefined, servicePrincipalId: string | undefined): Router {
  const router = Router();
  const authorize = createInternalApiAuth(internalApiToken, servicePrincipalId);

  router.post("/invoices", authorize, async (request, response) => {
    const principal = requireServicePrincipal(request.servicePrincipal);
    const organizationId = requiredUuidHeader(request, "X-Organization-Id");
    const actorUserId = requiredUuidHeader(request, "X-Actor-User-Id");
    const branchId = optionalUuidHeader(request, "X-Branch-Id");
    const service = new SalesTransactionService(new SupabaseSalesTransactionRepository(principal.id));
    const idempotencyKey = request.header("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
    }

    const body = requestSchema.parse(request.body);
    const normalized = {
      ...body,
      organization_id: organizationId,
      branch_id: branchId,
      actor_user_id: actorUserId,
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

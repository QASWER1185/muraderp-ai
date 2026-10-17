import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import type { PermissionCode } from "../auth/authorization.types.js";
import { env } from "../config/env.js";
import { ApiError } from "../errors/api-error.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { SupabaseInvoiceBrowserRepository, type InvoiceBrowserRepository } from "../repositories/invoice-browser.repository.js";
import { SupabaseEstimateRepository } from "../repositories/estimate.repository.js";
import { SupabaseSalesTransactionRepository } from "../repositories/sales-transaction.repository.js";
import { normalizeServicePrincipalId } from "../security/service-principal.js";
import { SalesTransactionService } from "../services/sales-transaction.service.js";
import type { EstimateAggregate } from "../services/estimate-clone-reprice.service.js";
import type { SalesTransactionPort } from "../types/sales-transaction.types.js";
import { requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";

const id = z.coerce.number().int().positive();
const page = z.object({ cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const line = z.strictObject({
  product_id: id,
  quantity: z.number().finite().positive(),
  unit: z.string().trim().min(1).max(50),
  unit_price: z.number().finite().nonnegative(),
  unit_cost: z.number().finite().nonnegative(),
});
const draft = z.strictObject({
  invoice_number: z.string().trim().min(1).max(100),
  customer_id: id,
  warehouse_id: id,
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency_code: z.literal("PKR"),
  notes: z.string().trim().max(2000).nullable().optional(),
  discount_total: z.number().finite().nonnegative().default(0),
  pass_through_rent: z.number().finite().nonnegative().default(0),
  lines: z.array(line).min(1).max(500),
});
const fromEstimateDraft = z.strictObject({
  source_estimate_id: id,
  invoice_number: z.string().trim().min(1).max(100),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  warehouse_id: id,
  unit_costs: z.array(z.strictObject({ line_number: id, unit_cost: z.number().finite().nonnegative() })).min(1).max(500),
});

function decimalParts(value: number): { digits: bigint; scale: number } {
  const [mantissa, exponentText] = value.toString().toLowerCase().split("e");
  const fractionLength = mantissa!.split(".")[1]?.length ?? 0;
  return { digits: BigInt(mantissa!.replace(".", "")), scale: fractionLength - Number(exponentText ?? 0) };
}

function decimalValue(digits: bigint, scale: number): number {
  if (scale <= 0) return Number(digits * 10n ** BigInt(-scale));
  const negative = digits < 0n;
  const absolute = (negative ? -digits : digits).toString().padStart(scale + 1, "0");
  return Number(`${negative ? "-" : ""}${absolute.slice(0, -scale)}.${absolute.slice(-scale)}`);
}

function decimalMultiply(left: number, right: number): number {
  const a = decimalParts(left); const b = decimalParts(right);
  return decimalValue(a.digits * b.digits, a.scale + b.scale);
}

function decimalSum(values: number[]): number {
  const parts = values.map(decimalParts);
  const scale = Math.max(0, ...parts.map((part) => part.scale));
  return decimalValue(parts.reduce((sum, part) => sum + part.digits * 10n ** BigInt(scale - part.scale), 0n), scale);
}

type EstimateReader = { getEstimateAggregate(id: number, organizationId: string): Promise<EstimateAggregate | null> };

export interface InvoiceBrowserOptions {
  repository?: InvoiceBrowserRepository | undefined;
  transaction?: SalesTransactionPort | undefined;
  estimateReader?: EstimateReader | undefined;
  tenantAuthorizer?: Pick<TenantAccessService, "assertAuthorized"> | undefined;
  authenticate?: RequestHandler | undefined;
  internalApiToken?: string | undefined;
  servicePrincipalId?: string | undefined;
}

function identityFor(request: Request) {
  if (!request.browserPrincipal) {
    const identity = requireAuthoritativeTransactionIdentity(request);
    return { userId: identity.actorUserId, organizationId: identity.organizationId, branchId: identity.branchId };
  }
  const origin = request.header("Origin");
  const fetchSite = request.header("Sec-Fetch-Site");
  const originHost = origin && URL.canParse(origin) ? new URL(origin).host : null;
  const forwardedHost = request.header("X-Forwarded-Host")?.trim();
  const sameHost = originHost === request.get("host");
  const sameProxiedHost = fetchSite === "same-origin" && originHost === forwardedHost;
  if (fetchSite === "cross-site" || (origin && (!originHost || (!sameHost && !sameProxiedHost)))) {
    throw new ApiError(403, "FORBIDDEN", "Same-origin request required");
  }
  const actor = request.header("X-Actor-User-Id")?.trim();
  if (actor && actor !== request.browserPrincipal.userId) throw new ApiError(403, "FORBIDDEN", "Actor does not match authenticated session");
  return {
    userId: request.browserPrincipal.userId,
    organizationId: z.string().uuid().parse(request.header("X-Organization-Id")),
    branchId: z.string().uuid().parse(request.header("X-Branch-Id")),
  };
}

export function createInvoiceBrowserRouter(options: InvoiceBrowserOptions = {}): Router {
  const router = Router();
  const repository = options.repository ?? new SupabaseInvoiceBrowserRepository();
  const estimateReader = options.estimateReader ?? new SupabaseEstimateRepository();
  const authenticate = options.authenticate ?? createCopilotAuth(options.internalApiToken, options.servicePrincipalId);
  let authorizer = options.tenantAuthorizer;
  router.use(authenticate);

  async function authorize(request: Request, permission: PermissionCode) {
    const identity = identityFor(request);
    authorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
    await authorizer.assertAuthorized(
      { userId: identity.userId, organizationId: identity.organizationId }, permission,
      { kind: "branch", branchId: identity.branchId },
    );
    return identity;
  }

  router.get("/", async (request, response) => {
    const identity = await authorize(request, "sales.read");
    const query = page.parse(request.query);
    response.setHeader("Cache-Control", "no-store");
    response.json(await repository.list(identity.organizationId, identity.branchId, query.limit, query.cursor));
  });

  router.get("/ready-estimates", async (request, response) => {
    const identity = await authorize(request, "sales.read");
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: await repository.listReadyEstimates(identity.organizationId, identity.branchId) });
  });

  async function readyEstimate(organizationId: string, branchId: string, sourceId: number) {
    const source = await estimateReader.getEstimateAggregate(sourceId, organizationId);
    if (!source || source.record.branch_id !== branchId || source.record.status !== "READY") {
      throw new ApiError(404, "READY_ESTIMATE_NOT_FOUND", "Ready estimate was not found in this workspace");
    }
    return source;
  }

  router.get("/ready-estimates/:id", async (request, response) => {
    const identity = await authorize(request, "sales.read");
    const source = await readyEstimate(identity.organizationId, identity.branchId, id.parse(request.params.id));
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: {
      id: source.record.id, estimate_number: source.record.estimate_number,
      customer_id: source.record.customer_id, currency_code: source.record.currency_code,
      pass_through_rent: source.record.pass_through_rent ?? 0,
      lines: source.items.map((item) => ({ line_number: item.line_number, product_id: item.product_id, quantity: item.quantity, unit: item.unit, unit_price: item.unit_price, discount_amount: item.discount_amount })),
    } });
  });

  router.get("/:id", async (request, response) => {
    const identity = await authorize(request, "sales.read");
    const found = await repository.getById(identity.organizationId, identity.branchId, id.parse(request.params.id));
    if (!found) throw new ApiError(404, "NOT_FOUND", "Invoice was not found");
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: found });
  });

  router.post("/", async (request, response) => {
    const identity = await authorize(request, "sales.create");
    const key = request.header("Idempotency-Key")?.trim();
    if (!key || key.length > 255) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key is required");
    const input = draft.parse(request.body);
    const lines = input.lines.map((item, index) => ({
      ...item, line_number: index + 1,
      line_total: decimalMultiply(item.quantity, item.unit_price),
      cogs_total: decimalMultiply(item.quantity, item.unit_cost),
    }));
    const subtotal = decimalSum(lines.map((item) => item.line_total));
    const grandTotal = decimalSum([subtotal, -input.discount_total]);
    if (grandTotal <= 0) throw new ApiError(400, "INVALID_TOTAL", "Invoice total must be greater than zero after discount");
    const principal = normalizeServicePrincipalId(options.servicePrincipalId ?? env.INTERNAL_API_PRINCIPAL_ID);
    if (!principal) throw new ApiError(503, "ERP_NOT_CONFIGURED", "Invoice service principal is not configured");
    const transaction = options.transaction ?? new SupabaseSalesTransactionRepository(principal);
    const result = await new SalesTransactionService(transaction).createInvoice({
      organization_id: identity.organizationId,
      branch_id: identity.branchId,
      actor_user_id: identity.userId,
      idempotency_key: key,
      warehouse_id: input.warehouse_id,
      invoice: {
        id: 0, status: "DRAFT", source_estimate_id: null, source_type: "DIRECT",
        definition: {
          invoice_number: input.invoice_number,
          customer_id: input.customer_id,
          issue_date: input.issue_date,
          currency_code: input.currency_code,
          notes: input.notes ?? null,
          salesperson_id: null,
        },
        lines: lines.map((item) => ({
          line_number: item.line_number, product_id: item.product_id, quantity: item.quantity,
          unit: item.unit, unit_price: item.unit_price, pricing_source: "MANUAL_OVERRIDE" as const,
        })),
        subtotal, discount_total: input.discount_total, grand_total: grandTotal,
        pass_through_rent: input.pass_through_rent,
      },
      lines,
    });
    response.setHeader("Cache-Control", "no-store");
    response.status(201).json({ data: result });
  });

  router.post("/from-estimate", async (request, response) => {
    const identity = await authorize(request, "sales.create");
    const key = request.header("Idempotency-Key")?.trim();
    if (!key || key.length > 255) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key is required");
    const input = fromEstimateDraft.parse(request.body);
    const source = await readyEstimate(identity.organizationId, identity.branchId, input.source_estimate_id);
    if (source.record.currency_code !== "PKR") throw new ApiError(400, "CURRENCY_NOT_SUPPORTED", "This invoice form supports PKR estimates only");
    const costs = new Map(input.unit_costs.map((item) => [item.line_number, item.unit_cost]));
    if (costs.size !== source.items.length || source.items.some((item) => !costs.has(item.line_number))) {
      throw new ApiError(400, "COSTS_REQUIRED", "Every estimate line needs one explicit unit cost");
    }
    const lines = source.items.map((item) => ({
      line_number: item.line_number, product_id: item.product_id, quantity: item.quantity,
      unit: item.unit, unit_price: item.unit_price, line_total: decimalMultiply(item.quantity, item.unit_price),
      unit_cost: costs.get(item.line_number)!, cogs_total: decimalMultiply(item.quantity, costs.get(item.line_number)!),
    }));
    const subtotal = decimalSum(lines.map((item) => item.line_total));
    const discount = decimalSum(source.items.map((item) => item.discount_amount));
    const principal = normalizeServicePrincipalId(options.servicePrincipalId ?? env.INTERNAL_API_PRINCIPAL_ID);
    if (!principal) throw new ApiError(503, "ERP_NOT_CONFIGURED", "Invoice service principal is not configured");
    const transaction = options.transaction ?? new SupabaseSalesTransactionRepository(principal);
    const result = await new SalesTransactionService(transaction).createInvoice({
      organization_id: identity.organizationId, branch_id: identity.branchId, actor_user_id: identity.userId,
      idempotency_key: key, warehouse_id: input.warehouse_id,
      invoice: {
        id: 0, status: "DRAFT", source_type: "FROM_ESTIMATE", source_estimate_id: source.record.id,
        definition: { invoice_number: input.invoice_number, customer_id: source.record.customer_id, issue_date: input.issue_date, currency_code: source.record.currency_code, notes: source.record.notes ?? null, salesperson_id: null },
        lines: source.items.map((item) => ({ line_number: item.line_number, product_id: item.product_id, quantity: item.quantity, unit: item.unit, unit_price: item.unit_price, discount_amount: item.discount_amount, pricing_source: item.pricing_source })),
        subtotal, discount_total: discount, grand_total: decimalSum([subtotal, -discount]),
        pass_through_rent: source.record.pass_through_rent ?? 0,
      },
      lines,
    });
    response.setHeader("Cache-Control", "no-store");
    response.status(201).json({ data: result });
  });
  return router;
}

import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { deletionIdentity } from "./record-deletion.routes.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { getSupabaseAdminClient } from "../config/supabase.js";
import type { PermissionCode } from "../auth/authorization.types.js";
import { ApiError } from "../errors/api-error.js";

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: any; error: { code?: string; message?: string } | null }>;
export interface RickshawOptions {
  internalApiToken?: string | undefined;
  servicePrincipalId?: string | undefined;
  tenantAuthorizer?: Pick<TenantAccessService, "assertAuthorized"> | undefined;
  authenticate?: RequestHandler;
  rpc?: Rpc;
}
const id = z.coerce.number().int().positive();
const english = z.string().trim().max(2000).regex(/^[\x20-\x7E]*$/, "Use English text");
const trip = z.strictObject({
  date: z.string().date().optional(), driver_id: z.number().int().positive(),
  material: z.enum(["cement", "sand", "bajri", "bricks", "other"]),
  quantity: z.number().finite().positive().max(1e9), unit: z.enum(["bags", "trolley", "cft"]),
  rate_type: z.enum(["FIXED", "PER_UNIT"]), rate: z.number().finite().positive().max(1e9),
  customer_id: z.number().int().positive().nullable().optional(), invoice_id: z.number().int().positive().nullable().optional(),
  notes: english.optional(),
});
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export function createRickshawRouter(options: RickshawOptions = {}) {
  const router = Router();
  const authenticate = options.authenticate ?? createCopilotAuth(options.internalApiToken, options.servicePrincipalId);
  const rpc: Rpc = options.rpc ?? ((name, args) => (getSupabaseAdminClient() as any).rpc(name, args));
  let authorizer = options.tenantAuthorizer;
  async function context(req: Request, permission: PermissionCode) {
    const i = deletionIdentity(req);
    authorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
    await authorizer.assertAuthorized({ userId: i.userId, organizationId: i.organizationId }, permission, { kind: "branch", branchId: i.branchId });
    return { p_organization_id: i.organizationId, p_branch_id: i.branchId, p_actor_user_id: i.userId };
  }
  async function call(name: string, args: Record<string, unknown>) {
    const result = await rpc(name, args);
    if (result.error) {
      const code = result.error.code ?? "";
      const status = code === "42501" ? 403 : ["23514", "23503", "23505", "40001", "40P01"].includes(code) ? 409 : code.startsWith("22") || code === "23502" ? 400 : 502;
      throw new ApiError(status, "RICKSHAW_REQUEST_REFUSED", status === 502 ? "Rickshaw request could not be completed" : result.error.message ?? "Rickshaw request was refused");
    }
    if (result.data == null) throw new ApiError(404, "NOT_FOUND", "Trip was not found in this branch");
    return result.data;
  }
  const key = (req: Request) => z.string().trim().min(1).max(128).parse(req.header("Idempotency-Key"));
  router.get("/drivers", authenticate, async (req, res) => {
    const args = await context(req, "sales.read");
    res.setHeader("Cache-Control", "no-store"); res.json({ data: await call("rickshaw_drivers", { ...args, p_input: null }) });
  });
  router.post("/drivers", authenticate, async (req, res) => {
    const args = await context(req, "payments.create");
    const input = z.strictObject({ name: english.min(1).max(160), phone: english.max(40).optional(), plate_number: english.max(40).optional() }).parse(req.body);
    res.status(201).json({ data: await call("rickshaw_drivers", { ...args, p_input: input }) });
  });
  router.get("/trips/daily-summary", authenticate, async (req, res) => {
    const args = await context(req, "reports.view"), date = z.string().date().parse(req.query.date ?? today());
    res.setHeader("Cache-Control", "no-store"); res.json({ data: await call("rickshaw_register", { ...args, p_date: date, p_summary: true }) });
  });
  router.get("/trips", authenticate, async (req, res) => {
    const args = await context(req, "sales.read"), date = z.string().date().parse(req.query.date ?? today());
    res.setHeader("Cache-Control", "no-store"); res.json({ data: await call("rickshaw_register", { ...args, p_date: date, p_summary: false }) });
  });
  router.post("/trips", authenticate, async (req, res) => {
    const args = await context(req, "sales.create"), input = trip.parse(req.body);
    res.status(201).json({ data: await call("rickshaw_save_trip", { ...args, p_input: { ...input, date: input.date ?? today() }, p_id: null, p_delete: false, p_key: key(req) }) });
  });
  router.patch("/trips/:id", authenticate, async (req, res) => {
    const args = await context(req, "sales.create"), input = trip.partial().refine(v => Object.keys(v).length > 0, "Provide trip changes").parse(req.body);
    res.json({ data: await call("rickshaw_save_trip", { ...args, p_input: input, p_id: id.parse(req.params.id), p_delete: false, p_key: null }) });
  });
  router.delete("/trips/:id", authenticate, async (req, res) => {
    const args = await context(req, "sales.create");
    await call("rickshaw_save_trip", { ...args, p_input: {}, p_id: id.parse(req.params.id), p_delete: true, p_key: null }); res.status(204).send();
  });
  router.post("/trips/payments", authenticate, async (req, res) => {
    const args = await context(req, "payments.create");
    const input = z.strictObject({ driver_id: z.number().int().positive(), date: z.string().date().optional(), amount: z.number().finite().positive().max(1e9), payment_method: z.enum(["CASH", "BANK"]).default("CASH") }).parse(req.body);
    res.status(201).json({ data: await call("rickshaw_pay_driver", { ...args, p_input: { ...input, date: input.date ?? today() }, p_key: key(req) }) });
  });
  return router;
}

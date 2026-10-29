import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import type { PermissionCode } from "../auth/authorization.types.js";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { ApiError } from "../errors/api-error.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { SupabaseCustomerCenterRepository, type CustomerCenterRange, type CustomerCenterRepository } from "../repositories/customer-center.repository.js";
import {
  SupabaseErpService,
  type CustomerInput,
  type ErpService,
  type Patch,
} from "../services/erp.service.js";
import { requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";

const idSchema = z.coerce.number().int().positive();
const pageSchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const customerListQuerySchema = pageSchema.extend({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: "The start date must be on or before the end date" });
const customerCenterRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: "The start date must be on or before the end date" });
const shortText = z.string().trim().min(1).max(200);
const customerFields = {
  name: shortText,
  phone: z.string().trim().min(1).max(50),
  city: z.string().trim().min(1).max(120),
  opening_balance: z.number().finite().min(-999999999999).max(999999999999),
};
const customerSchema = z.strictObject({ ...customerFields, opening_balance: customerFields.opening_balance.default(0) });
const customerPatchSchema = z.strictObject(customerFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });

type CustomerService = Pick<
  ErpService,
  "listCustomers" | "getCustomer" | "createCustomer" | "updateCustomer" | "deleteCustomer"
>;
type CustomerAuthorizer = Pick<TenantAccessService, "assertAuthorized">;

export interface CustomerRouterOptions {
  internalApiToken?: string | undefined;
  servicePrincipalId?: string | undefined;
  service?: CustomerService | undefined;
  centerRepository?: CustomerCenterRepository | undefined;
  tenantAuthorizer?: CustomerAuthorizer | undefined;
  authenticate?: RequestHandler | undefined;
}

interface CustomerIdentity {
  userId: string;
  organizationId: string;
  branchId: string;
}

function headerValue(request: Request, name: string): string | undefined {
  const value = request.header(name);
  return Array.isArray(value) ? value[0] : value;
}

function customerIdentity(request: Request): CustomerIdentity {
  if (!request.browserPrincipal) {
    const identity = requireAuthoritativeTransactionIdentity(request);
    return {
      userId: identity.actorUserId,
      organizationId: identity.organizationId,
      branchId: identity.branchId,
    };
  }

  const requestedActor = headerValue(request, "X-Actor-User-Id")?.trim();
  if (requestedActor && requestedActor !== request.browserPrincipal.userId) {
    throw new ApiError(403, "FORBIDDEN", "Actor does not match authenticated session");
  }

  return {
    userId: request.browserPrincipal.userId,
    organizationId: z.string().uuid().parse(headerValue(request, "X-Organization-Id")),
    branchId: z.string().uuid().parse(headerValue(request, "X-Branch-Id")),
  };
}

export function createCustomerRouter(options: CustomerRouterOptions = {}): Router {
  const router = Router();
  const service = options.service ?? new SupabaseErpService();
  const centerRepository = options.centerRepository ?? new SupabaseCustomerCenterRepository();
  const authenticate = options.authenticate ?? createCopilotAuth(options.internalApiToken, options.servicePrincipalId);
  let tenantAuthorizer = options.tenantAuthorizer;

  router.use(authenticate);

  async function authorize(request: Request, permission: PermissionCode): Promise<CustomerIdentity> {
    const identity = customerIdentity(request);
    tenantAuthorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
    await tenantAuthorizer.assertAuthorized(
      { userId: identity.userId, organizationId: identity.organizationId },
      permission,
      { kind: "branch", branchId: identity.branchId },
    );
    return identity;
  }

  router.get("/", async (request, response) => {
    const identity = await authorize(request, "customers.read");
    const query = customerListQuerySchema.parse(request.query);
    const page = await service.listCustomers({ cursor: query.cursor, limit: query.limit }, identity.organizationId);
    const range: CustomerCenterRange = { ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}) };
    const metrics = await centerRepository.listMetrics(identity.organizationId, identity.branchId, page.data.map((customer) => customer.id), range);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({
      ...page,
      data: page.data.map((customer) => ({
        ...customer,
        ...(metrics.get(customer.id) ?? { balance: 0, estimates_count: 0, estimates_total_amount: 0, invoices_total_amount: 0, payments_total_amount: 0 }),
      })),
    });
  });

  router.get("/:id/center", async (request, response) => {
    const identity = await authorize(request, "customers.read");
    const customer = await service.getCustomer(idSchema.parse(request.params.id), identity.organizationId);
    if (!customer) throw new ApiError(404, "NOT_FOUND", "Customer was not found");
    const queryRange = customerCenterRangeSchema.parse(request.query);
    const range: CustomerCenterRange = { ...(queryRange.from ? { from: queryRange.from } : {}), ...(queryRange.to ? { to: queryRange.to } : {}) };
    const summaryAndTransactions = await centerRepository.getCenter(identity.organizationId, identity.branchId, customer.id, range);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({
      data: {
        customer: { id: customer.id, name: customer.name, phone: customer.phone, address: (customer as typeof customer & { address?: string | null }).address ?? customer.city ?? "", city: customer.city },
        ...summaryAndTransactions,
      },
    });
  });

  router.get("/:id", async (request, response) => {
    const identity = await authorize(request, "customers.read");
    const customer = await service.getCustomer(idSchema.parse(request.params.id), identity.organizationId);
    if (!customer) throw new ApiError(404, "NOT_FOUND", "Customer was not found");
    response.status(200).json({ data: customer });
  });

  router.post("/", async (request, response) => {
    const identity = await authorize(request, "customers.write");
    const customer = await service.createCustomer(customerSchema.parse(request.body), identity.organizationId);
    response.status(201).json({ data: customer });
  });

  router.patch("/:id", async (request, response) => {
    const identity = await authorize(request, "customers.write");
    const customer = await service.updateCustomer(
      idSchema.parse(request.params.id),
      customerPatchSchema.parse(request.body) as Patch<CustomerInput>,
      identity.organizationId,
    );
    if (!customer) throw new ApiError(404, "NOT_FOUND", "Customer was not found");
    response.status(200).json({ data: customer });
  });

  router.delete("/:id", async (request, response) => {
    const identity = await authorize(request, "customers.write");
    const deleted = await service.deleteCustomer(idSchema.parse(request.params.id), identity.organizationId);
    if (!deleted) throw new ApiError(404, "NOT_FOUND", "Customer was not found");
    response.status(204).send();
  });

  return router;
}

import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import type { PermissionCode } from "../auth/authorization.types.js";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { ApiError } from "../errors/api-error.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { SupabaseErpService, type ErpService, type Patch, type ProductInput } from "../services/erp.service.js";
import { requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";

const idSchema = z.coerce.number().int().positive();
const productPageSchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).optional(),
});
const productSchema = z.strictObject({
  brand_id: idSchema.nullable().optional(),
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(50),
  purchase_price: z.number().finite().nonnegative().nullable(),
  sale_price: z.number().finite().nonnegative(),
});
const productPatchSchema = productSchema.partial().refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });

type ProductService = Pick<ErpService, "listProducts" | "getProduct" | "createProduct" | "updateProduct">;
type ProductAuthorizer = Pick<TenantAccessService, "assertAuthorized">;

export interface ProductRouterOptions {
  internalApiToken?: string | undefined;
  servicePrincipalId?: string | undefined;
  service?: ProductService | undefined;
  tenantAuthorizer?: ProductAuthorizer | undefined;
  authenticate?: RequestHandler | undefined;
}

interface ProductIdentity {
  userId: string;
  organizationId: string;
  branchId: string;
}

function headerValue(request: Request, name: string): string | undefined {
  const value = request.header(name);
  return Array.isArray(value) ? value[0] : value;
}

function productIdentity(request: Request): ProductIdentity {
  if (!request.browserPrincipal) {
    const identity = requireAuthoritativeTransactionIdentity(request);
    return { userId: identity.actorUserId, organizationId: identity.organizationId, branchId: identity.branchId };
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

export function createProductRouter(options: ProductRouterOptions = {}): Router {
  const router = Router();
  const service = options.service ?? new SupabaseErpService();
  const authenticate = options.authenticate ?? createCopilotAuth(options.internalApiToken, options.servicePrincipalId);
  let tenantAuthorizer = options.tenantAuthorizer;

  router.use(authenticate);

  async function authorize(request: Request, permission: PermissionCode): Promise<ProductIdentity> {
    const identity = productIdentity(request);
    tenantAuthorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
    await tenantAuthorizer.assertAuthorized(
      { userId: identity.userId, organizationId: identity.organizationId },
      permission,
      { kind: "branch", branchId: identity.branchId },
    );
    return identity;
  }

  router.get("/", async (request, response) => {
    const identity = await authorize(request, "products.read");
    response.status(200).json(await service.listProducts(productPageSchema.parse(request.query), identity.organizationId));
  });

  router.get("/:id", async (request, response) => {
    const identity = await authorize(request, "products.read");
    const product = await service.getProduct(idSchema.parse(request.params.id), identity.organizationId);
    if (!product) throw new ApiError(404, "NOT_FOUND", "Product was not found");
    response.status(200).json({ data: product });
  });

  router.post("/", async (request, response) => {
    const identity = await authorize(request, "products.write");
    const product = await service.createProduct(productSchema.parse(request.body), identity.organizationId);
    response.status(201).json({ data: product });
  });

  router.patch("/:id", async (request, response) => {
    const identity = await authorize(request, "products.write");
    const product = await service.updateProduct(
      idSchema.parse(request.params.id),
      productPatchSchema.parse(request.body) as Patch<ProductInput>,
      identity.organizationId,
    );
    if (!product) throw new ApiError(404, "NOT_FOUND", "Product was not found");
    response.status(200).json({ data: product });
  });

  return router;
}

import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import type { PermissionCode } from "../auth/authorization.types.js";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { ApiError } from "../errors/api-error.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { SupabaseRateListRepository } from "../repositories/rate-list.repository.js";
import { SupabaseErpService, type ErpService } from "../services/erp.service.js";
import { DefaultPricingService } from "../services/pricing.service.js";
import { DefaultRateListService } from "../services/rate-list.service.js";
import { DefaultRateListPublicationService } from "../services/rate-list.lifecycle.js";
import { requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";

const id = z.coerce.number().int().positive();
const rateListInput = z.strictObject({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(100),
  price_type: z.enum(["SALE", "PURCHASE"]),
  scope_type: z.enum(["GLOBAL", "CUSTOMER", "VENDOR"]),
  customer_id: id.nullable().optional(),
  vendor_id: id.nullable().optional(),
  currency_code: z.string().trim().length(3).default("PKR"),
});
const itemInput = z.strictObject({ product_id: id, minimum_quantity: z.number().finite().positive(), unit_price: z.number().finite().nonnegative(), unit: z.string().trim().min(1).max(50) });
const draftInput = z.strictObject({ version_number: z.number().int().positive(), effective_from: z.string().date(), items: z.array(itemInput).min(1).max(500) });
const priceQuery = z.object({ product_id: id, quantity: z.coerce.number().finite().positive(), as_of: z.string().date(), customer_id: id.optional(), vendor_id: id.optional() });

type References = Pick<ErpService, "getCustomer" | "getVendor" | "getProduct">;
type RateLists = Pick<SupabaseRateListRepository, "listRateLists" | "getRateList" | "listVersions" | "listItems" | "createRateList" | "createDraftVersion" | "findBestRateListItem" | "publishVersion">;

export interface RateListBrowserOptions {
  repository?: RateLists | undefined;
  references?: References | undefined;
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
  return { userId: request.browserPrincipal.userId, organizationId: z.string().uuid().parse(request.header("X-Organization-Id")), branchId: z.string().uuid().parse(request.header("X-Branch-Id")) };
}

function mutationError(error: unknown): never {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "Rate List operation failed";
  if (code === "23505") throw new ApiError(409, "DUPLICATE_RATE_LIST", "Rate List code, version, or product quantity tier already exists");
  if (code === "23503" || code === "23514" || code === "22023" || code === "42501" || code === "P0002" || /^rate.list|^only draft|^new active/i.test(message)) {
    throw new ApiError(400, "RATE_LIST_INVALID", message);
  }
  throw error;
}

export function createRateListBrowserRouter(options: RateListBrowserOptions = {}): Router {
  const router = Router();
  const repository = options.repository ?? new SupabaseRateListRepository();
  const references = options.references ?? new SupabaseErpService();
  const authoring = new DefaultRateListService(repository as SupabaseRateListRepository);
  const publication = new DefaultRateListPublicationService(repository);
  const pricing = new DefaultPricingService(repository);
  const authenticate = options.authenticate ?? createCopilotAuth(options.internalApiToken, options.servicePrincipalId);
  let tenantAuthorizer = options.tenantAuthorizer;
  router.use(authenticate);

  async function authorize(request: Request, permission: PermissionCode) {
    const identity = identityFor(request);
    tenantAuthorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
    await tenantAuthorizer.assertAuthorized({ userId: identity.userId, organizationId: identity.organizationId }, permission, { kind: "branch", branchId: identity.branchId });
    return identity;
  }
  async function listFor(idValue: number, organizationId: string) {
    const list = await repository.getRateList(idValue, organizationId);
    if (!list) throw new ApiError(404, "RATE_LIST_NOT_FOUND", "Rate List was not found in this organization");
    return list;
  }

  router.get("/", async (request, response) => {
    const identity = await authorize(request, "products.read");
    const lists = await repository.listRateLists(identity.organizationId);
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: lists });
  });

  router.get("/:id", async (request, response) => {
    const identity = await authorize(request, "products.read");
    const list = await listFor(id.parse(request.params.id), identity.organizationId);
    const versions = await repository.listVersions(list.id);
    const items = await repository.listItems(versions.map((version) => version.id));
    const products = await Promise.all([...new Set(items.map((item) => item.product_id))].map((productId) => references.getProduct(productId, identity.organizationId)));
    const productMap = new Map(products.filter((product) => product !== null).map((product) => [product.id, product]));
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: { list, versions: versions.map((version) => ({ ...version, items: items.filter((item) => item.rate_list_version_id === version.id).map((item) => ({ ...item, product: productMap.get(item.product_id) ?? null })) })) } });
  });

  router.post("/", async (request, response) => {
    const identity = await authorize(request, "products.write");
    const input = rateListInput.parse(request.body);
    if (input.scope_type === "GLOBAL" && (input.customer_id != null || input.vendor_id != null)) throw new ApiError(400, "RATE_LIST_INVALID", "Global Rate Lists cannot target a customer or vendor");
    if (input.scope_type === "CUSTOMER" && (input.customer_id == null || input.vendor_id != null || !await references.getCustomer(input.customer_id, identity.organizationId))) throw new ApiError(400, "RATE_LIST_INVALID", "Select a customer in this organization");
    if (input.scope_type === "VENDOR" && (input.vendor_id == null || input.customer_id != null || !await references.getVendor(input.vendor_id, identity.organizationId))) throw new ApiError(400, "RATE_LIST_INVALID", "Select a vendor in this organization");
    if ((input.price_type === "SALE" && input.scope_type === "VENDOR") || (input.price_type === "PURCHASE" && input.scope_type === "CUSTOMER")) throw new ApiError(400, "RATE_LIST_INVALID", "Rate List scope does not match its price type");
    try { response.status(201).json({ data: await authoring.createRateList({ ...input, organization_id: identity.organizationId }) }); } catch (error) { mutationError(error); }
  });

  router.post("/:id/versions", async (request, response) => {
    const identity = await authorize(request, "products.write");
    const list = await listFor(id.parse(request.params.id), identity.organizationId);
    if (!list.is_active) throw new ApiError(409, "RATE_LIST_INACTIVE", "An inactive Rate List cannot accept a version");
    const input = draftInput.parse(request.body);
    for (const productId of new Set(input.items.map((item) => item.product_id))) {
      const product = await references.getProduct(productId, identity.organizationId);
      if (!product) throw new ApiError(400, "RATE_LIST_INVALID", `Product ${productId} is outside this organization`);
      if (input.items.some((item) => item.product_id === productId && item.unit !== product.unit)) throw new ApiError(400, "RATE_LIST_INVALID", `Product ${productId} must use its catalogue unit (${product.unit})`);
    }
    try { response.status(201).json({ data: await authoring.createDraftVersion({ ...input, effective_from: `${input.effective_from}T00:00:00.000Z`, rate_list_id: list.id, organization_id: identity.organizationId }) }); } catch (error) { mutationError(error); }
  });

  router.post("/:id/versions/:versionId/publish", async (request, response) => {
    const identity = await authorize(request, "products.write");
    const list = await listFor(id.parse(request.params.id), identity.organizationId);
    const versionId = id.parse(request.params.versionId);
    const versions = await repository.listVersions(list.id);
    if (!versions.some((version) => version.id === versionId)) throw new ApiError(404, "RATE_LIST_VERSION_NOT_FOUND", "Version was not found in this Rate List");
    try { response.json({ data: await publication.publish(versionId, identity.organizationId) }); } catch (error) { mutationError(error); }
  });

  router.get("/:id/price", async (request, response) => {
    const identity = await authorize(request, "products.read");
    const list = await listFor(id.parse(request.params.id), identity.organizationId);
    const query = priceQuery.parse(request.query);
    if (!await references.getProduct(query.product_id, identity.organizationId)) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found in this organization");
    if (!list.is_active) throw new ApiError(409, "RATE_LIST_INACTIVE", "Rate List is inactive");
    if (list.scope_type === "CUSTOMER" && list.customer_id !== query.customer_id) throw new ApiError(403, "RATE_LIST_SCOPE_DENIED", "Rate List requires its customer context");
    if (list.scope_type === "VENDOR" && list.vendor_id !== query.vendor_id) throw new ApiError(403, "RATE_LIST_SCOPE_DENIED", "Rate List requires its vendor context");
    const price = await pricing.resolvePrice({ organization_id: identity.organizationId, price_type: list.price_type, rate_list_id: list.id, product_id: query.product_id, quantity: query.quantity, as_of: query.as_of, customer_id: query.customer_id ?? null, vendor_id: query.vendor_id ?? null });
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: price });
  });

  return router;
}

import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import type { PermissionCode } from "../auth/authorization.types.js";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { createInternalApiAuth } from "../middleware/internal-api-auth.js";
import {
  SupabaseErpService,
  type ErpService,
  type Patch,
  type RecordPurchaseInput,
  type Vendor,
  type VendorInput,
} from "../services/erp.service.js";
import {
  authoritativeRequestFingerprint,
  requireAuthoritativeTransactionIdentity,
} from "./authoritative-transaction-context.js";

const idSchema = z.coerce.number().int().positive();
const PURCHASE_OPERATION = "purchase.create" as const;
const pageSchema = z.object({ cursor: idSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const inventoryPageSchema = pageSchema.extend({ product_id: idSchema.optional(), warehouse_id: idSchema.optional() });
const shortText = z.string().trim().min(1).max(200);
const nullableText = z.string().trim().min(1).max(500).nullable().optional();
const brandSchema = z.strictObject({ name: shortText });
const partySchema = z.strictObject({ name: shortText, phone: z.string().trim().min(1).max(50), city: z.string().trim().min(1).max(120) });
const productSchema = z.strictObject({
  brand_id: idSchema.nullable().optional(),
  name: shortText,
  sku: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(50),
  purchase_price: z.number().finite().nonnegative(),
  sale_price: z.number().finite().nonnegative(),
});
const warehouseSchema = z.strictObject({ name: shortText, location: nullableText });

function atLeastOneField<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.partial().refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });
}

const purchaseSchema = z.strictObject({
  vendor_id: idSchema,
  warehouse_id: idSchema,
  items: z.array(z.strictObject({ product_id: idSchema, quantity: z.number().finite().positive(), unit_cost: z.number().finite().positive() })).min(1).max(500),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  invoice_number: z.string().trim().min(1).max(100).optional(),
  discount: z.number().finite().nonnegative().optional(),
  tax: z.number().finite().nonnegative().optional(),
  notes: z.string().trim().min(1).max(2_000).optional(),
});

interface CrudActions<CreateInput, UpdateInput, Entity extends { id: number }> {
  list: ErpServiceList<Entity>;
  get: (id: number) => Promise<Entity | null>;
  create: (input: CreateInput) => Promise<Entity>;
  update: (id: number, input: UpdateInput) => Promise<Entity | null>;
  delete: (id: number) => Promise<boolean>;
}

type ErpServiceList<Entity extends { id: number }> = (page: z.output<typeof pageSchema>) => Promise<{ data: Entity[]; next_cursor: number | null }>;
type TenantAuthorizer = Pick<TenantAccessService, "assertAuthorized">;

function registerCrud<CreateInput, UpdateInput, Entity extends { id: number }>(
  router: Router,
  path: string,
  resourceName: string,
  authorize: RequestHandler,
  createSchema: z.ZodType<CreateInput>,
  updateSchema: z.ZodType<UpdateInput>,
  actions: CrudActions<CreateInput, UpdateInput, Entity>,
) {
  router.get(path, authorize, async (request, response) => { response.status(200).json(await actions.list(pageSchema.parse(request.query))); });
  router.get(`${path}/:id`, authorize, async (request, response) => {
    const record = await actions.get(idSchema.parse(request.params.id));
    if (!record) throw new ApiError(404, "NOT_FOUND", `${resourceName} was not found`);
    response.status(200).json({ data: record });
  });
  router.post(path, authorize, async (request, response) => { const record = await actions.create(createSchema.parse(request.body)); response.status(201).json({ data: record }); });
  router.patch(`${path}/:id`, authorize, async (request, response) => {
    const record = await actions.update(idSchema.parse(request.params.id), updateSchema.parse(request.body));
    if (!record) throw new ApiError(404, "NOT_FOUND", `${resourceName} was not found`);
    response.status(200).json({ data: record });
  });
  router.delete(`${path}/:id`, authorize, async (request, response) => {
    const deleted = await actions.delete(idSchema.parse(request.params.id));
    if (!deleted) throw new ApiError(404, "NOT_FOUND", `${resourceName} was not found`);
    response.status(204).send();
  });
}

function effectivePurchaseDate(input: RecordPurchaseInput): string { return input.purchase_date ?? new Date().toISOString().slice(0, 10); }
function normalizedPurchaseForFingerprint(input: RecordPurchaseInput): RecordPurchaseInput {
  return {
    vendor_id: input.vendor_id,
    warehouse_id: input.warehouse_id,
    items: input.items.map((item) => ({ product_id: item.product_id, quantity: item.quantity, unit_cost: item.unit_cost })),
    purchase_date: effectivePurchaseDate(input),
    invoice_number: input.invoice_number?.trim().toLowerCase(),
    discount: input.discount ?? 0,
    tax: input.tax ?? 0,
    notes: input.notes?.trim(),
  };
}
export function createErpRouter(
  internalApiToken?: string,
  servicePrincipalId?: string,
  service: ErpService = new SupabaseErpService(),
  tenantAuthorizer?: TenantAuthorizer,
) {
  const router = Router();
  const authorize = createInternalApiAuth(internalApiToken, servicePrincipalId);
  let productTenantAuthorizer = tenantAuthorizer;

  async function authorizeProduct(request: Parameters<typeof requireAuthoritativeTransactionIdentity>[0], permission: PermissionCode) {
    const identity = requireAuthoritativeTransactionIdentity(request);
    productTenantAuthorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
    await productTenantAuthorizer.assertAuthorized(
      { userId: identity.actorUserId, organizationId: identity.organizationId },
      permission,
      { kind: "branch", branchId: identity.branchId },
    );
    return identity;
  }

  router.get("/brands", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "products.read");
    response.status(200).json(await service.listBrands(pageSchema.parse(request.query), identity.organizationId));
  });
  router.get("/brands/:id", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "products.read");
    const brand = await service.getBrand(idSchema.parse(request.params.id), identity.organizationId);
    if (!brand) throw new ApiError(404, "NOT_FOUND", "Brand was not found");
    response.status(200).json({ data: brand });
  });
  router.post("/brands", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "products.write");
    response.status(201).json({ data: await service.createBrand(brandSchema.parse(request.body), identity.organizationId) });
  });
  router.patch("/brands/:id", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "products.write");
    const brand = await service.updateBrand(idSchema.parse(request.params.id), atLeastOneField(brandSchema).parse(request.body), identity.organizationId);
    if (!brand) throw new ApiError(404, "NOT_FOUND", "Brand was not found");
    response.status(200).json({ data: brand });
  });
  router.delete("/brands/:id", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "products.write");
    if (!await service.deleteBrand(idSchema.parse(request.params.id), identity.organizationId)) throw new ApiError(404, "NOT_FOUND", "Brand was not found");
    response.status(204).send();
  });
  registerCrud<VendorInput, Patch<VendorInput>, Vendor>(router, "/vendors", "Vendor", authorize, partySchema, atLeastOneField(partySchema), {
    list: (page) => service.listVendors(page), get: (id) => service.getVendor(id), create: (input) => service.createVendor(input), update: (id, input) => service.updateVendor(id, input), delete: (id) => service.deleteVendor(id),
  });
  router.get("/products", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "products.read");
    response.status(200).json(await service.listProducts(pageSchema.parse(request.query), identity.organizationId));
  });
  router.get("/products/:id", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "products.read");
    const product = await service.getProduct(idSchema.parse(request.params.id), identity.organizationId);
    if (!product) throw new ApiError(404, "NOT_FOUND", "Product was not found");
    response.status(200).json({ data: product });
  });
  router.post("/products", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "products.write");
    const product = await service.createProduct(productSchema.parse(request.body), identity.organizationId);
    response.status(201).json({ data: product });
  });
  router.patch("/products/:id", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "products.write");
    const product = await service.updateProduct(
      idSchema.parse(request.params.id),
      atLeastOneField(productSchema).parse(request.body),
      identity.organizationId,
    );
    if (!product) throw new ApiError(404, "NOT_FOUND", "Product was not found");
    response.status(200).json({ data: product });
  });
  router.delete("/products/:id", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "products.write");
    const deleted = await service.deleteProduct(idSchema.parse(request.params.id), identity.organizationId);
    if (!deleted) throw new ApiError(404, "NOT_FOUND", "Product was not found");
    response.status(204).send();
  });
  router.get("/warehouses", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "inventory.read");
    response.status(200).json(await service.listWarehouses(pageSchema.parse(request.query), identity.organizationId));
  });
  router.get("/warehouses/:id", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "inventory.read");
    const warehouse = await service.getWarehouse(idSchema.parse(request.params.id), identity.organizationId);
    if (!warehouse) throw new ApiError(404, "NOT_FOUND", "Warehouse was not found");
    response.status(200).json({ data: warehouse });
  });
  router.post("/warehouses", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "inventory.adjust");
    response.status(201).json({ data: await service.createWarehouse(warehouseSchema.parse(request.body), identity.organizationId) });
  });
  router.patch("/warehouses/:id", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "inventory.adjust");
    const warehouse = await service.updateWarehouse(idSchema.parse(request.params.id), atLeastOneField(warehouseSchema).parse(request.body), identity.organizationId);
    if (!warehouse) throw new ApiError(404, "NOT_FOUND", "Warehouse was not found");
    response.status(200).json({ data: warehouse });
  });
  router.delete("/warehouses/:id", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "inventory.adjust");
    if (!await service.deleteWarehouse(idSchema.parse(request.params.id), identity.organizationId)) throw new ApiError(404, "NOT_FOUND", "Warehouse was not found");
    response.status(204).send();
  });

  router.get("/inventory", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "inventory.read");
    response.status(200).json(await service.listInventory(inventoryPageSchema.parse(request.query), identity.organizationId));
  });
  router.get("/stock-movements", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "inventory.read");
    response.status(200).json(await service.listStockMovements(inventoryPageSchema.parse(request.query), identity.organizationId, identity.branchId));
  });
  router.get("/purchases", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "purchases.read");
    response.status(200).json(await service.listPurchases(pageSchema.parse(request.query), identity.organizationId, identity.branchId));
  });
  router.get("/purchases/:id", authorize, async (request, response) => {
    const identity = await authorizeProduct(request, "purchases.read");
    const purchase = await service.getPurchase(idSchema.parse(request.params.id), identity.organizationId, identity.branchId);
    if (!purchase) throw new ApiError(404, "NOT_FOUND", "Purchase was not found");
    response.status(200).json({ data: purchase });
  });

  router.post("/purchases", authorize, async (request, response) => {
    const identity = requireAuthoritativeTransactionIdentity(request);
    const idempotencyKey = request.header("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) throw new ApiError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required");
    const parsedInput = purchaseSchema.parse(request.body);
    const normalizedInput = normalizedPurchaseForFingerprint(parsedInput);
    const purchase = await service.recordPurchase(normalizedInput, {
      ...identity,
      operation: PURCHASE_OPERATION,
      idempotencyKey,
      requestFingerprint: authoritativeRequestFingerprint(identity, PURCHASE_OPERATION, normalizedInput),
    });
    response.status(201).json({ data: purchase });
  });

  return router;
}

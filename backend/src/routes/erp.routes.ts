import { createHash } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import { createInternalApiAuth } from "../middleware/internal-api-auth.js";
import { requireServicePrincipal } from "../security/service-principal.js";
import {
  SupabaseErpService,
  type Brand,
  type BrandInput,
  type Customer,
  type CustomerInput,
  type ErpService,
  type Patch,
  type Product,
  type ProductInput,
  type RecordPurchaseInput,
  type Vendor,
  type VendorInput,
  type Warehouse,
  type WarehouseInput,
} from "../services/erp.service.js";

const idSchema = z.coerce.number().int().positive();
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
function purchaseFingerprint(input: RecordPurchaseInput): string {
  return createHash("sha256").update(JSON.stringify(normalizedPurchaseForFingerprint(input)), "utf8").digest("hex");
}

export function createErpRouter(
  internalApiToken?: string,
  servicePrincipalId?: string,
  service: ErpService = new SupabaseErpService(),
) {
  const router = Router();
  const authorize = createInternalApiAuth(internalApiToken, servicePrincipalId);

  registerCrud<BrandInput, Patch<BrandInput>, Brand>(router, "/brands", "Brand", authorize, brandSchema, atLeastOneField(brandSchema), {
    list: (page) => service.listBrands(page), get: (id) => service.getBrand(id), create: (input) => service.createBrand(input), update: (id, input) => service.updateBrand(id, input), delete: (id) => service.deleteBrand(id),
  });
  registerCrud<CustomerInput, Patch<CustomerInput>, Customer>(router, "/customers", "Customer", authorize, partySchema, atLeastOneField(partySchema), {
    list: (page) => service.listCustomers(page), get: (id) => service.getCustomer(id), create: (input) => service.createCustomer(input), update: (id, input) => service.updateCustomer(id, input), delete: (id) => service.deleteCustomer(id),
  });
  registerCrud<VendorInput, Patch<VendorInput>, Vendor>(router, "/vendors", "Vendor", authorize, partySchema, atLeastOneField(partySchema), {
    list: (page) => service.listVendors(page), get: (id) => service.getVendor(id), create: (input) => service.createVendor(input), update: (id, input) => service.updateVendor(id, input), delete: (id) => service.deleteVendor(id),
  });
  registerCrud<ProductInput, Patch<ProductInput>, Product>(router, "/products", "Product", authorize, productSchema, atLeastOneField(productSchema), {
    list: (page) => service.listProducts(page), get: (id) => service.getProduct(id), create: (input) => service.createProduct(input), update: (id, input) => service.updateProduct(id, input), delete: (id) => service.deleteProduct(id),
  });
  registerCrud<WarehouseInput, Patch<WarehouseInput>, Warehouse>(router, "/warehouses", "Warehouse", authorize, warehouseSchema, atLeastOneField(warehouseSchema), {
    list: (page) => service.listWarehouses(page), get: (id) => service.getWarehouse(id), create: (input) => service.createWarehouse(input), update: (id, input) => service.updateWarehouse(id, input), delete: (id) => service.deleteWarehouse(id),
  });

  router.get("/inventory", authorize, async (request, response) => { response.status(200).json(await service.listInventory(inventoryPageSchema.parse(request.query))); });
  router.get("/stock-movements", authorize, async (request, response) => { response.status(200).json(await service.listStockMovements(inventoryPageSchema.parse(request.query))); });
  router.get("/purchases", authorize, async (request, response) => { response.status(200).json(await service.listPurchases(pageSchema.parse(request.query))); });
  router.get("/purchases/:id", authorize, async (request, response) => {
    const purchase = await service.getPurchase(idSchema.parse(request.params.id));
    if (!purchase) throw new ApiError(404, "NOT_FOUND", "Purchase was not found");
    response.status(200).json({ data: purchase });
  });

  router.post("/purchases", authorize, async (request, response) => {
    const principal = requireServicePrincipal(request.servicePrincipal);
    const idempotencyKey = request.header("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) throw new ApiError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required");
    const parsedInput = purchaseSchema.parse(request.body);
    const normalizedInput = normalizedPurchaseForFingerprint(parsedInput);
    const purchase = await service.recordPurchase(normalizedInput, {
      principalScope: principal.id,
      operation: "purchase.create",
      idempotencyKey,
      requestFingerprint: purchaseFingerprint(parsedInput),
    });
    response.status(201).json({ data: purchase });
  });

  return router;
}

import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { ApiError } from "../errors/api-error.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { SupabaseErpService, type ErpService } from "../services/erp.service.js";
import { requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";

type DashboardService = Pick<ErpService, "listStockMovements" | "getProduct">;
type TenantAuthorizer = Pick<TenantAccessService, "assertAuthorized">;

export interface DashboardRouterOptions {
  internalApiToken?: string | undefined;
  servicePrincipalId?: string | undefined;
  service?: DashboardService | undefined;
  tenantAuthorizer?: TenantAuthorizer | undefined;
  authenticate?: RequestHandler | undefined;
  countEstimates?: ((organizationId: string, branchId: string) => Promise<number>) | undefined;
}

function identityFor(request: Request) {
  if (!request.browserPrincipal) {
    const identity = requireAuthoritativeTransactionIdentity(request);
    return { userId: identity.actorUserId, organizationId: identity.organizationId, branchId: identity.branchId };
  }
  const origin = request.header("Origin");
  if (request.header("Sec-Fetch-Site") === "cross-site" || (origin && new URL(origin).host !== request.get("host"))) {
    throw new ApiError(403, "FORBIDDEN", "Same-origin request required");
  }
  return {
    userId: request.browserPrincipal.userId,
    organizationId: z.string().uuid().parse(request.header("X-Organization-Id")),
    branchId: z.string().uuid().parse(request.header("X-Branch-Id")),
  };
}

export function createDashboardRouter(options: DashboardRouterOptions = {}): Router {
  const router = Router();
  const service = options.service ?? new SupabaseErpService();
  const authenticate = options.authenticate ?? createCopilotAuth(options.internalApiToken, options.servicePrincipalId);
  let tenantAuthorizer = options.tenantAuthorizer;

  router.get("/estimates/count", authenticate, async (request, response) => {
    const identity = identityFor(request);
    tenantAuthorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
    await tenantAuthorizer.assertAuthorized(
      { userId: identity.userId, organizationId: identity.organizationId },
      "sales.read",
      { kind: "branch", branchId: identity.branchId },
    );
    let count: number;
    if (options.countEstimates) {
      count = await options.countEstimates(identity.organizationId, identity.branchId);
    } else {
      const client = getSupabaseServiceRoleClient() as unknown as { from(table: "estimates"): any };
      const { count: total, error } = await client.from("estimates")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", identity.organizationId).eq("branch_id", identity.branchId);
      if (error || total == null) throw new ApiError(502, "ESTIMATE_READ_FAILED", "Estimate count could not be loaded");
      count = total;
    }
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: { count } });
  });

  router.get("/stock", authenticate, async (request, response) => {
    const identity = identityFor(request);
    tenantAuthorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
    await tenantAuthorizer.assertAuthorized(
      { userId: identity.userId, organizationId: identity.organizationId },
      "inventory.read",
      { kind: "branch", branchId: identity.branchId },
    );
    const movements = [];
    let cursor: number | undefined;
    do {
      const page = await service.listStockMovements({ limit: 100, ...(cursor === undefined ? {} : { cursor }) }, identity.organizationId, identity.branchId);
      movements.push(...page.data);
      cursor = page.next_cursor ?? undefined;
    } while (cursor !== undefined);
    const productIds = [...new Set(movements.map((item) => item.product_id))];
    const products = await Promise.all(productIds.map((id) => service.getProduct(id, identity.organizationId)));
    const productById = new Map(products.filter((product) => product !== null).map((product) => [product.id, product]));
    const grouped = new Map<number, { product_id: number; current_stock: number; warehouses: Set<number> }>();
    for (const item of movements) {
      const existing = grouped.get(item.product_id) ?? { product_id: item.product_id, current_stock: 0, warehouses: new Set<number>() };
      const direction = ["OPENING", "PURCHASE", "SALE_RETURN", "TRANSFER_IN"].includes(item.movement_type) ? 1
        : ["SALE", "PURCHASE_RETURN", "TRANSFER_OUT"].includes(item.movement_type) ? -1 : 0;
      existing.current_stock += direction * Number(item.quantity);
      existing.warehouses.add(item.warehouse_id);
      grouped.set(item.product_id, existing);
    }
    const stock = [...grouped.values()].map((item) => {
      const product = productById.get(item.product_id);
      return {
        ...item,
        warehouses: item.warehouses.size,
        product_name: product?.name ?? "Product unavailable",
        sku: product?.sku ?? null,
        unit: product?.unit ?? "unit",
        rate: product?.sale_price ?? null,
        status: item.current_stock <= 0 ? "OUT_OF_STOCK" : "IN_STOCK",
      };
    }).sort((left, right) => left.current_stock - right.current_stock || left.product_name.localeCompare(right.product_name));
    response.status(200).json({
      data: {
        inventory_items: stock,
        inventory_truncated: false,
        reorder_levels_available: false,
        recent_activity: movements.slice(0, 6).map((movement) => ({
          id: movement.id,
          product_name: productById.get(movement.product_id)?.name ?? "Product unavailable",
          movement_type: movement.movement_type,
          quantity: movement.quantity,
          unit_cost: movement.unit_cost,
          notes: movement.notes,
          created_at: movement.created_at,
        })),
      },
    });
  });

  return router;
}

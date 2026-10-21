import type {
  InventoryAdjustmentDraft,
  InventoryContext,
  InventoryIntelligenceGateway,
  InventoryQuery,
} from "./inventory-intelligence.types.js";

const INVENTORY_QUERIES: readonly InventoryQuery[] = [
  "availability",
  "stock_by_warehouse",
  "movements",
  "low_stock",
  "valuation",
  "reconciliation",
];

function requireContext(context: InventoryContext): void {
  if (!context.organizationId.trim()) throw new Error("organizationId is required");
  if (!context.userId.trim()) throw new Error("userId is required");
  if (context.warehouseId !== undefined && !context.warehouseId.trim()) {
    throw new Error("warehouseId cannot be empty");
  }
}

function requireQuery(query: InventoryQuery): void {
  if (!INVENTORY_QUERIES.includes(query)) {
    throw new Error("unsupported inventory query");
  }
}

function requireScopedDraft(
  result: InventoryAdjustmentDraft,
  context: InventoryContext,
  requestedDraft: Omit<InventoryAdjustmentDraft, "organizationId" | "userId" | "requiresConfirmation">,
): void {
  if (result.organizationId !== context.organizationId || result.userId !== context.userId) {
    throw new Error("inventory adjustment draft context mismatch");
  }
  if (
    result.warehouseId !== requestedDraft.warehouseId ||
    result.productId !== requestedDraft.productId ||
    result.quantityDelta !== requestedDraft.quantityDelta ||
    result.reason !== requestedDraft.reason
  ) {
    throw new Error("inventory adjustment draft payload mismatch");
  }
}

export class InventoryIntelligenceService {
  constructor(private readonly gateway: InventoryIntelligenceGateway) {}

  async query(
    query: InventoryQuery,
    context: InventoryContext,
    productId?: string,
  ): Promise<unknown> {
    requireContext(context);
    requireQuery(query);
    if (productId !== undefined && !productId.trim()) {
      throw new Error("productId cannot be empty");
    }
    return this.gateway.query(query, context, productId);
  }

  async createAdjustmentDraft(
    context: InventoryContext,
    draft: Omit<InventoryAdjustmentDraft, "organizationId" | "userId" | "requiresConfirmation">,
  ): Promise<InventoryAdjustmentDraft> {
    requireContext(context);
    if (!draft.warehouseId.trim()) throw new Error("warehouseId is required");
    if (!draft.productId.trim()) throw new Error("productId is required");
    if (!Number.isFinite(draft.quantityDelta) || draft.quantityDelta === 0) {
      throw new Error("quantityDelta must be a finite non-zero number");
    }
    if (!draft.reason.trim()) throw new Error("reason is required");

    const result = await this.gateway.createAdjustmentDraft(context, draft);
    requireScopedDraft(result, context, draft);
    if (result.requiresConfirmation !== true) {
      throw new Error("Inventory adjustments must require explicit confirmation");
    }
    return result;
  }
}

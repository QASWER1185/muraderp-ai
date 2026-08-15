import type {
  InventoryAdjustmentDraft,
  InventoryContext,
  InventoryIntelligenceGateway,
  InventoryQuery,
} from "./inventory-intelligence.types.js";

function requireContext(context: InventoryContext): void {
  if (!context.organizationId.trim()) throw new Error("organizationId is required");
  if (!context.userId.trim()) throw new Error("userId is required");
  if (context.warehouseId !== undefined && !context.warehouseId.trim()) {
    throw new Error("warehouseId cannot be empty");
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
    if (!query) throw new Error("inventory query is required");
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
    if (result.requiresConfirmation !== true) {
      throw new Error("Inventory adjustments must require explicit confirmation");
    }
    return result;
  }
}

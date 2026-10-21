export type InventoryQuery =
  | "availability"
  | "stock_by_warehouse"
  | "movements"
  | "low_stock"
  | "valuation"
  | "reconciliation";

export type InventoryAction = "adjust_draft";

export interface InventoryContext {
  organizationId: string;
  userId: string;
  warehouseId?: string;
}

export interface InventoryAdjustmentDraft {
  organizationId: string;
  userId: string;
  warehouseId: string;
  productId: string;
  quantityDelta: number;
  reason: string;
  requiresConfirmation: true;
}

export interface InventoryIntelligenceGateway {
  query(query: InventoryQuery, context: InventoryContext, productId?: string): Promise<unknown>;
  createAdjustmentDraft(context: InventoryContext, draft: Omit<InventoryAdjustmentDraft, "organizationId" | "userId" | "requiresConfirmation">): Promise<InventoryAdjustmentDraft>;
}

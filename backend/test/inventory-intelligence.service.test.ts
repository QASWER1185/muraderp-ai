import { describe, expect, it, vi } from "vitest";
import { InventoryIntelligenceService } from "../src/inventory-intelligence/inventory-intelligence.service.js";

const context = { organizationId: "org-1", userId: "user-1", warehouseId: "wh-1" };

describe("InventoryIntelligenceService", () => {
  it("requires organization and user context", async () => {
    const gateway = { query: vi.fn(), createAdjustmentDraft: vi.fn() };
    const service = new InventoryIntelligenceService(gateway);
    await expect(service.query("availability", { organizationId: "", userId: "user-1" })).rejects.toThrow("organizationId is required");
    await expect(service.query("availability", { organizationId: "org-1", userId: "" })).rejects.toThrow("userId is required");
    expect(gateway.query).not.toHaveBeenCalled();
  });

  it("delegates authorized inventory queries through the gateway", async () => {
    const gateway = { query: vi.fn().mockResolvedValue({ available: 25 }), createAdjustmentDraft: vi.fn() };
    const service = new InventoryIntelligenceService(gateway);
    await expect(service.query("availability", context, "product-1")).resolves.toEqual({ available: 25 });
    expect(gateway.query).toHaveBeenCalledWith("availability", context, "product-1");
  });

  it("rejects empty product filters", async () => {
    const gateway = { query: vi.fn(), createAdjustmentDraft: vi.fn() };
    const service = new InventoryIntelligenceService(gateway);
    await expect(service.query("stock_by_warehouse", context, "   ")).rejects.toThrow("productId cannot be empty");
    expect(gateway.query).not.toHaveBeenCalled();
  });

  it("forces every adjustment through an explicit-confirmation draft", async () => {
    const gateway = {
      query: vi.fn(),
      createAdjustmentDraft: vi.fn().mockResolvedValue({
        ...context,
        warehouseId: "wh-1",
        productId: "product-1",
        quantityDelta: 5,
        reason: "cycle count",
        requiresConfirmation: true,
      }),
    };
    const service = new InventoryIntelligenceService(gateway);
    const result = await service.createAdjustmentDraft(context, {
      warehouseId: "wh-1",
      productId: "product-1",
      quantityDelta: 5,
      reason: "cycle count",
    });
    expect(result.requiresConfirmation).toBe(true);
    expect(gateway.createAdjustmentDraft).toHaveBeenCalledOnce();
  });

  it("rejects an adjustment that would bypass confirmation", async () => {
    const gateway = {
      query: vi.fn(),
      createAdjustmentDraft: vi.fn().mockResolvedValue({
        ...context,
        warehouseId: "wh-1",
        productId: "product-1",
        quantityDelta: 5,
        reason: "cycle count",
        requiresConfirmation: false,
      }),
    };
    const service = new InventoryIntelligenceService(gateway);
    await expect(service.createAdjustmentDraft(context, {
      warehouseId: "wh-1",
      productId: "product-1",
      quantityDelta: 5,
      reason: "cycle count",
    })).rejects.toThrow("must require explicit confirmation");
  });
});

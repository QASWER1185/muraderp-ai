import { describe, expect, it, vi } from "vitest";
import { SupabaseCopilotReferenceResolver } from "./copilot-reference.resolver.js";
import type { CopilotActionPlan } from "./copilot.types.js";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";

function plan(overrides: Partial<CopilotActionPlan> = {}): CopilotActionPlan {
  return {
    organizationId: ORGANIZATION_ID,
    branchId: "33333333-3333-4333-8333-333333333333",
    userId: "44444444-4444-4444-8444-444444444444",
    source: "text",
    target: "estimate",
    customerId: "1",
    warehouseId: 3,
    lines: [{
      productName: "Bestway Cement",
      productId: 4,
      quantity: 20,
      rateSource: "SELECTED_RATE_LIST",
      pricingSelection: { mode: "RATE_LIST", rate_list_id: 5, source: "INHERITED" },
    }],
    requiresConfirmation: true,
    ...overrides,
  };
}

function database(rows: Record<string, Array<Record<string, unknown>>>) {
  return {
    from: vi.fn((table: string) => {
      const filters: Array<[string, unknown]> = [];
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        maybeSingle: async () => ({
          data: (rows[table] ?? []).find((row) => filters.every(([column, value]) => row[column] === value)) ?? null,
          error: null,
        }),
      };
      return query;
    }),
  };
}

describe("AI-native Copilot reference resolution", () => {
  it("accepts only organization-owned customer, warehouse, Product, and Rate List references", async () => {
    const db = database({
      customers: [{ id: 1, organization_id: ORGANIZATION_ID }],
      warehouses: [{ id: 3, organization_id: ORGANIZATION_ID }],
      products: [{ id: 4, organization_id: ORGANIZATION_ID }],
      rate_lists: [{ id: 5, organization_id: ORGANIZATION_ID }],
    });
    const resolver = new SupabaseCopilotReferenceResolver(() => db as never);

    await expect(resolver.assertOwnedReferences(plan())).resolves.toBeUndefined();
    expect(db.from).toHaveBeenCalledTimes(4);
  });

  it("rejects an AI-provided cross-organization Product ID", async () => {
    const db = database({
      customers: [{ id: 1, organization_id: ORGANIZATION_ID }],
      warehouses: [{ id: 3, organization_id: ORGANIZATION_ID }],
      products: [{ id: 4, organization_id: OTHER_ORGANIZATION_ID }],
      rate_lists: [{ id: 5, organization_id: ORGANIZATION_ID }],
    });
    const resolver = new SupabaseCopilotReferenceResolver(() => db as never);

    await expect(resolver.assertOwnedReferences(plan())).rejects.toMatchObject({
      code: "COPILOT_REFERENCE_UNRESOLVED",
    });
  });

  it("rejects a cross-organization Rate List even when the Product is valid", async () => {
    const db = database({
      customers: [{ id: 1, organization_id: ORGANIZATION_ID }],
      warehouses: [{ id: 3, organization_id: ORGANIZATION_ID }],
      products: [{ id: 4, organization_id: ORGANIZATION_ID }],
      rate_lists: [{ id: 5, organization_id: OTHER_ORGANIZATION_ID }],
    });
    const resolver = new SupabaseCopilotReferenceResolver(() => db as never);

    await expect(resolver.assertOwnedReferences(plan())).rejects.toMatchObject({
      code: "COPILOT_REFERENCE_UNRESOLVED",
    });
  });

  it("validates supplier ownership without trusting an AI-provided vendor ID", async () => {
    const db = database({
      vendors: [{ id: 2, organization_id: ORGANIZATION_ID }],
      warehouses: [{ id: 3, organization_id: ORGANIZATION_ID }],
      products: [{ id: 4, organization_id: ORGANIZATION_ID }],
    });
    const resolver = new SupabaseCopilotReferenceResolver(() => db as never);
    const supplierPlan = plan({
      target: "supplier_bill",
      vendorId: "2",
      lines: [{ productName: "Cement", productId: 4, quantity: 1, rateSource: "EXPLICIT_USER_RATE", explicitUnitRate: 10 }],
    });
    delete supplierPlan.customerId;

    await expect(resolver.assertOwnedReferences(supplierPlan)).resolves.toBeUndefined();
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CopilotRuntime } from "../src/ai-copilot/copilot.runtime.js";
import type { CopilotActionPlan } from "../src/ai-copilot/copilot.types.js";
import type { ErpService } from "../src/services/erp.service.js";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_USER_ID = "33333333-3333-4333-8333-333333333333";
const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/20260902103000_products_module_security_hardening.sql"),
  "utf8",
);

describe("Products final database and AI safety gate", () => {
  it("adds forward-only tenant ownership enforcement for Product-linked master data", () => {
    expect(migration).toContain("products_products_gate_organization_required");
    expect(migration).toContain("inventory_products_gate_product_ownership_fkey");
    expect(migration).toContain("products_products_gate_brand_ownership_fkey");
    expect(migration).toContain("estimates_products_gate_customer_ownership_fkey");
    expect(migration).toContain("enforce_estimate_item_product_ownership");
  });

  it("makes Product and rate-list business identifiers tenant-scoped", () => {
    expect(migration).toContain("products_products_gate_scoped_sku_key");
    expect(migration).toContain("rate_lists_products_gate_scoped_code_key");
    expect(migration).toContain("estimates_products_gate_scoped_number_key");
    expect(migration).toContain("enforce_rate_list_item_product_ownership");
  });

  it("revokes the legacy unscoped SECURITY DEFINER inventory-adjustment RPC", () => {
    expect(migration).toMatch(
      /revoke all on function public\.record_inventory_adjustment\([\s\S]*?\) from public, anon, authenticated, service_role;/,
    );
  });

  it("keeps AI inventory adjustment proposal-only when no accounting-safe engine exists", async () => {
    const database = vi.fn();
    const runtime = new CopilotRuntime({} as ErpService, {
      authorization: { assertPermission: vi.fn() },
      erp: {} as ErpService,
      pricing: {} as never,
      estimate: {} as never,
      salesTransaction: { execute: vi.fn() },
      returns: { recordSalesReturn: vi.fn() },
      database,
      servicePrincipalId: "muraderp-products-test-01",
    });
    const plan: CopilotActionPlan = {
      organizationId: ORGANIZATION_ID,
      branchId: BRANCH_ID,
      userId: ACTOR_USER_ID,
      source: "camera",
      target: "inventory_adjustment",
      warehouseId: 10,
      reason: "cycle count",
      lines: [{
        productName: "Bestway Cement",
        productId: 20,
        quantity: 30,
        rateSource: "UNRESOLVED",
      }],
      requiresConfirmation: true,
    };

    await expect(
      (runtime as unknown as { execute(value: CopilotActionPlan, key: string): Promise<unknown> })
        .execute(plan, "products-final-adjustment"),
    ).rejects.toMatchObject({ code: "AUTHORITATIVE_INVENTORY_ADJUSTMENT_UNAVAILABLE" });
    expect(database).not.toHaveBeenCalled();
  });
});

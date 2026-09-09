import { getSupabaseAdminClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { CopilotActionPlan } from "./copilot.types.js";

type CopilotDatabase = ReturnType<typeof getSupabaseAdminClient>;

export interface CopilotReferenceResolver {
  assertOwnedReferences(plan: CopilotActionPlan): Promise<void>;
}

function positiveId(value: string | number, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(422, "COPILOT_REFERENCE_UNRESOLVED", `${field} must be a positive integer`);
  }
  return parsed;
}

export class SupabaseCopilotReferenceResolver implements CopilotReferenceResolver {
  constructor(private readonly clientFactory: () => CopilotDatabase = getSupabaseAdminClient) {}

  private async assertOrganizationOwned(
    table: "customers" | "vendors" | "products" | "warehouses" | "rate_lists",
    id: number,
    organizationId: string,
    label: string,
  ): Promise<void> {
    const { data, error } = await (this.clientFactory() as any)
      .from(table)
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new ApiError(
        422,
        "COPILOT_REFERENCE_UNRESOLVED",
        `${label} could not be resolved in the Copilot organization`,
      );
    }
  }

  async assertOwnedReferences(plan: CopilotActionPlan): Promise<void> {
    const checks: Array<Promise<void>> = [];

    if (plan.customerId !== undefined) {
      checks.push(this.assertOrganizationOwned(
        "customers",
        positiveId(plan.customerId, "customerId"),
        plan.organizationId,
        "Customer",
      ));
    }
    if (plan.vendorId !== undefined) {
      checks.push(this.assertOrganizationOwned(
        "vendors",
        positiveId(plan.vendorId, "vendorId"),
        plan.organizationId,
        "Vendor",
      ));
    }
    if (plan.warehouseId !== undefined) {
      checks.push(this.assertOrganizationOwned(
        "warehouses",
        plan.warehouseId,
        plan.organizationId,
        "Warehouse",
      ));
    }

    const productIds = new Set<number>();
    const rateListIds = new Set<number>();
    for (const line of plan.lines) {
      if (line.productId !== undefined) productIds.add(line.productId);
      const pricingSelection = line.pricingSelection;
      if (pricingSelection?.mode === "RATE_LIST") {
        rateListIds.add(positiveId(pricingSelection.rate_list_id ?? "", "rateListId"));
      }
    }
    for (const productId of productIds) {
      checks.push(this.assertOrganizationOwned(
        "products",
        productId,
        plan.organizationId,
        `Product ${productId}`,
      ));
    }
    for (const rateListId of rateListIds) {
      checks.push(this.assertOrganizationOwned(
        "rate_lists",
        rateListId,
        plan.organizationId,
        `Rate List ${rateListId}`,
      ));
    }

    await Promise.all(checks);
  }
}

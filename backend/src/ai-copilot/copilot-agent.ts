import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import { UnifiedCopilotAgent } from "./agent/agent.js";
import { createUnifiedAgent } from "./agent/factory.js";
import { resolveCandidates } from "../services/entity-search.service.js";
import { CONVERSATIONAL_INSTRUCTIONS } from "./agent/model.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import type { PermissionCode } from "../auth/authorization.types.js";
import { type ErpService } from "../services/erp.service.js";
import { type PricingService } from "../services/pricing.service.js";
import { SupabaseRateListRepository } from "../repositories/rate-list.repository.js";
import { CopilotRuntime } from "./copilot.runtime.js";

const id = z.number().int().positive();
const search = z.strictObject({ query: z.string().trim().min(1).max(120) });
const byId = z.strictObject({ id });
const rate = z.strictObject({
  productId: id,
  quantity: z.number().finite().positive(),
  priceType: z.enum(["SALE", "PURCHASE"]),
  customerId: id.nullable(),
  vendorId: id.nullable(),
  rateListId: id.nullable(),
});
const noArguments = z.strictObject({});
type Context = { userId: string; organizationId: string; branchId: string };
export type AgentResult = { message: string; review?: unknown; toolNames: string[] };

export interface AgentModel {
  toolTurn(instructions: string, input: unknown[], tools: unknown[]): Promise<{ output: any[] }>;
}

export interface AgentDependencies {
  model: AgentModel;
  access: Pick<TenantAccessService, "assertAuthorized" | "assertBranchAccess">;
  erp: Pick<ErpService, "listProducts" | "getProduct" | "getCustomer" | "getVendor">;
  pricing: Pick<PricingService, "resolvePrice">;
  rateLists: Pick<SupabaseRateListRepository, "listRateLists" | "getRateList">;
  runtime: Pick<CopilotRuntime, "prepareReview">;
}

const integer = { type: "integer", minimum: 1 };
const text = { type: "string", minLength: 1 };
function definition(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return { type: "function", name, description, parameters: { type: "object", properties, required, additionalProperties: false }, strict: true };
}

/** Only capabilities backed by existing ERP services are advertised. */
export const COPILOT_TOOLS = [
  definition("search_products", "Search this organization's live product catalog by name, size, brand, or SKU.", { query: text }, ["query"]),
  definition("get_product", "Read a product by its verified numeric ID.", { id: integer }, ["id"]),
  definition("search_rate_lists", "List this organization's available Rate Lists. Use this to resolve a named list or ambiguity.", {}, []),
  definition("get_rate", "Resolve an authoritative current rate for a verified product and quantity. Null context fields mean unspecified; an ambiguous or missing rate must be clarified.", {
    productId: integer, quantity: { type: "number", exclusiveMinimum: 0 }, priceType: { type: "string", enum: ["SALE", "PURCHASE"] },
    customerId: { anyOf: [integer, { type: "null" }] }, vendorId: { anyOf: [integer, { type: "null" }] }, rateListId: { anyOf: [integer, { type: "null" }] },
  }, ["productId", "quantity", "priceType", "customerId", "vendorId", "rateListId"]),
  definition("get_customer", "Read a customer by verified numeric ID.", { id: integer }, ["id"]),
  definition("get_vendor", "Read a vendor by verified numeric ID.", { id: integer }, ["id"]),
  definition("prepare_estimate", "Prepare an existing ERP estimate review for owner approval using the user's original request. This does not create or post an estimate.", {}, []),
  definition("prepare_supplier_bill", "Prepare an existing ERP supplier bill review for owner approval using the user's original request. This does not post a bill.", {}, []),
  definition("prepare_customer_return", "Prepare an existing ERP customer return review for owner approval using the user's original request. This does not post a return.", {}, []),
] as const;



export class CopilotAgent {
  private readonly dependencies: AgentDependencies;
  readonly core: UnifiedCopilotAgent;
  constructor(input: AgentDependencies | UnifiedCopilotAgent) {
    if (input instanceof UnifiedCopilotAgent) {
      this.core = input;
      this.dependencies = undefined as unknown as AgentDependencies;
    } else {
      this.dependencies = input;
      this.core = new UnifiedCopilotAgent({
        respond: async (messages, tools, signal) => {
          if (signal.aborted) throw new Error("Agent deadline exceeded");
          const step = await input.model.toolTurn(CONVERSATIONAL_INSTRUCTIONS, messages, tools);
          const text = step.output.flatMap(item => item?.type === "message" ? item.content ?? [] : [])
            .filter(part => part?.type === "output_text").map(part => part.text).join("\n").trim();
          return { output: step.output, text };
        },
      }, {
        definitions: () => [...COPILOT_TOOLS],
        assertScope: context => input.access.assertBranchAccess(context, context.branchId),
        execute: async (name, args, context, _state, originalMessage) => {
          const result = await this.call(name, JSON.stringify(args), context, originalMessage ?? "");
          if (result.review) return result;
          if (name === "search_products") {
            const page = result.data as { data: Array<{ id: number; name: string; sku: string; unit: string }> };
            return resolveCandidates(page.data.map(row => ({ ...row, confidence: 1, match_kind: "exact_name" })), 25);
          }
          return result.data;
        },
      });
    }
  }

  private async authorized(context: Context, permission: PermissionCode) {
    await this.dependencies.access.assertAuthorized(
      { userId: context.userId, organizationId: context.organizationId }, permission,
      { kind: "branch", branchId: context.branchId },
    );
  }

  private async call(name: string, raw: string, context: Context, originalMessage: string): Promise<{ data: unknown; review?: unknown }> {
    if (raw.length > 25_000) throw new ApiError(422, "AI_TOOL_ARGUMENTS_INVALID", "Copilot tool arguments are too large");
    let args: unknown;
    try { args = JSON.parse(raw); } catch { throw new ApiError(422, "AI_TOOL_ARGUMENTS_INVALID", "Copilot tool arguments are invalid"); }
    const org = context.organizationId;
    if (name === "search_products") {
      await this.authorized(context, "products.read");
      const page = await this.dependencies.erp.listProducts({ search: search.parse(args).query, limit: 25 }, org);
      return { data: { ...page, data: page.data.map((product) => ({ id: product.id, name: product.name, sku: product.sku, unit: product.unit, brand_id: product.brand_id })) } };
    }
    if (name === "get_product") {
      await this.authorized(context, "products.read");
      const product = await this.dependencies.erp.getProduct(byId.parse(args).id, org);
      return { data: product ? { id: product.id, name: product.name, sku: product.sku, unit: product.unit, brand_id: product.brand_id } : null };
    }
    if (name === "search_rate_lists") {
      noArguments.parse(args);
      await this.authorized(context, "products.read");
      return { data: await this.dependencies.rateLists.listRateLists(org) };
    }
    if (name === "get_customer") {
      await this.authorized(context, "customers.read");
      return { data: await this.dependencies.erp.getCustomer(byId.parse(args).id, org) };
    }
    if (name === "get_vendor") {
      await this.authorized(context, "vendors.read");
      return { data: await this.dependencies.erp.getVendor(byId.parse(args).id, org) };
    }
    if (name === "get_rate") {
      const input = rate.parse(args);
      await this.authorized(context, "products.read");
      const product = await this.dependencies.erp.getProduct(input.productId, org);
      if (!product) return { data: { error: "Product not found in this organization" } };
      if (input.customerId !== null) {
        await this.authorized(context, "customers.read");
        if (!await this.dependencies.erp.getCustomer(input.customerId, org)) return { data: { error: "Customer not found in this organization" } };
      }
      if (input.vendorId !== null) {
        await this.authorized(context, "vendors.read");
        if (!await this.dependencies.erp.getVendor(input.vendorId, org)) return { data: { error: "Vendor not found in this organization" } };
      }
      if (input.rateListId !== null) {
        const list = await this.dependencies.rateLists.getRateList(input.rateListId, org);
        if (!list || !list.is_active || list.price_type !== input.priceType ||
          (list.scope_type === "CUSTOMER" && list.customer_id !== input.customerId) ||
          (list.scope_type === "VENDOR" && list.vendor_id !== input.vendorId)) {
          return { data: { error: "Rate List is unavailable for this organization, party, and price type" } };
        }
      }
      try {
        const resolved = await this.dependencies.pricing.resolvePrice({
          organization_id: org, product_id: input.productId, quantity: input.quantity,
          price_type: input.priceType, as_of: new Date().toISOString(),
          customer_id: input.customerId, vendor_id: input.vendorId, rate_list_id: input.rateListId,
        });
        return { data: resolved ? { product: { id: product.id, name: product.name, sku: product.sku }, rate: resolved } : { product: { id: product.id, name: product.name }, rate: null, message: "No applicable current rate" } };
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Ambiguous pricing:")) return { data: { error: "Multiple rates apply; ask the owner to choose a Rate List" } };
        throw error;
      }
    }
    if (name === "prepare_estimate" || name === "prepare_supplier_bill" || name === "prepare_customer_return") {
      noArguments.parse(args);
      const intent = name === "prepare_estimate" ? "estimate" : name === "prepare_supplier_bill" ? "supplier_bill" : "customer_return";
      const review = await this.dependencies.runtime.prepareReview({ ...context, source: "text", intent, text: originalMessage }, context.branchId);
      return { data: { intent: review.intent, blockingReasons: review.blockingReasons, warnings: review.warnings, requiresConfirmation: true }, review };
    }
    throw new ApiError(422, "AI_TOOL_UNKNOWN", "Copilot requested an unavailable ERP capability");
  }

  async respond(message: string, context: Context, conversationToken?: string, conversationId?: string) {
    const result = await this.core.run({ message, conversationToken, conversationId }, context);
    return { ...result, message: result.answer };
  }
}

export function createCopilotAgent(): CopilotAgent {
  return new CopilotAgent(createUnifiedAgent());
}

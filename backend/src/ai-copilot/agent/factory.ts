import { ApiError } from "../../errors/api-error.js";
import { env } from "../../config/env.js";
import { getSupabaseAdminClient } from "../../config/supabase.js";
import { TenantAccessService } from "../../auth/tenant-access.service.js";
import { SupabaseAuthorizationGateway, createAuthorizationClient } from "../../auth/supabase-authorization.gateway.js";
import { SupabaseErpService } from "../../services/erp.service.js";
import { SupabaseEntitySearchService } from "../../services/entity-search.service.js";
import { DefaultPricingService } from "../../services/pricing.service.js";
import { SupabaseRateListRepository } from "../../repositories/rate-list.repository.js";
import { SupabaseCopilotCatalogRepository } from "../copilot-review.js";
import { UnifiedCopilotAgent } from "./agent.js";
import { ErpToolRegistry } from "./erp-tools.js";
import { ProviderAgentModel } from "./model.js";
import { SupabaseCopilotBusinessRepository } from "../../repositories/copilot-business.repository.js";
import { SupabaseCustomerPaymentBrowserRepository } from "../../repositories/customer-payment-browser.repository.js";
import { SupabaseVendorPaymentBrowserRepository } from "../../repositories/vendor-payment-browser.repository.js";
import type { AiProviderContract, ToolCallingAiProvider } from "../../ai/providers/contracts.js";
import { CopilotRuntime } from "../copilot.runtime.js";
import { hasConfiguredAiProvider } from "../../ai/providers/factory.js";
import { BasicInventoryModel } from "./basic-inventory-model.js";
import { CustomerMemoryStore } from "../customerMemoryStore.js";
import { CopilotAnalytics } from "../analytics.js";

export function createConversationalTools(provider?: ToolCallingAiProvider): ErpToolRegistry {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new ApiError(503, "COPILOT_NOT_CONFIGURED", "ERP data access is not configured");
  const authorization = new SupabaseAuthorizationGateway(createAuthorizationClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY));
  const rateLists = new SupabaseRateListRepository();
  const erp = new SupabaseErpService();
  return new ErpToolRegistry({
    analytics:new CopilotAnalytics(getSupabaseAdminClient),
    tenant: new TenantAccessService(authorization), erp,
    memory:new CustomerMemoryStore(),
    catalog: new SupabaseCopilotCatalogRepository(getSupabaseAdminClient),
    search: new SupabaseEntitySearchService(), pricing: new DefaultPricingService(rateLists), rateLists,
    runtime: { createMasterDataDraft: (...args) => {
      const fullProvider = provider && "generate" in provider && "transcribe" in provider ? provider as AiProviderContract : undefined;
      return new CopilotRuntime(undefined, undefined, fullProvider).createMasterDataDraft(...args);
    },
    createUnifiedDraft:(...args)=>new CopilotRuntime().createUnifiedDraft(...args),
    reviseUnifiedDraft:(...args)=>new CopilotRuntime().reviseUnifiedDraft(...args),
    inspectUnifiedDraft:(...args)=>new CopilotRuntime().inspectUnifiedDraft(...args),
    getBusinessReport:(...args)=>new CopilotRuntime().getBusinessReport(...args),
    getDepotReport:(...args)=>new CopilotRuntime().getDepotReport(...args),
    confirmAndExecute:(...args)=>new CopilotRuntime().confirmAndExecute(...args),
    },
  }, true, { erp, repository: new SupabaseCopilotBusinessRepository(), customers: new SupabaseCustomerPaymentBrowserRepository(), vendors: new SupabaseVendorPaymentBrowserRepository() });
}
export function createUnifiedAgent(provider?: ToolCallingAiProvider): UnifiedCopilotAgent {
  const advanced = provider || hasConfiguredAiProvider() ? new ProviderAgentModel(provider) : undefined;
  return new UnifiedCopilotAgent(new BasicInventoryModel(advanced), createConversationalTools(provider));
}

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

export function createConversationalTools(): ErpToolRegistry {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new ApiError(503, "COPILOT_NOT_CONFIGURED", "ERP data access is not configured");
  const authorization = new SupabaseAuthorizationGateway(createAuthorizationClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY));
  const rateLists = new SupabaseRateListRepository();
  return new ErpToolRegistry({
    tenant: new TenantAccessService(authorization), erp: new SupabaseErpService(),
    catalog: new SupabaseCopilotCatalogRepository(getSupabaseAdminClient),
    search: new SupabaseEntitySearchService(), pricing: new DefaultPricingService(rateLists), rateLists,
  }, true);
}
export function createUnifiedAgent(): UnifiedCopilotAgent {
  return new UnifiedCopilotAgent(new ProviderAgentModel(), createConversationalTools());
}

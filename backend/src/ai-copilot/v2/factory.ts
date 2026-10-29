import { createLiveGeminiProvider } from './live-provider.js';
import type { AiProviderContract } from '../../ai/providers/contracts.js';
import { SupabaseErpService } from '../../services/erp.service.js';
import { TenantAccessService } from '../../auth/tenant-access.service.js';
import { createServiceRoleAuthorizationGateway } from '../../auth/supabase-authorization.gateway.js';
import { SupabaseEstimateBrowserRepository } from '../../repositories/estimate-browser.repository.js';
import { DefaultPricingService } from '../../services/pricing.service.js';
import { SupabaseRateListRepository } from '../../repositories/rate-list.repository.js';
import { CopilotRuntime } from '../copilot.runtime.js';
import { createConversationalTools } from '../agent/factory.js';
import { SupabaseV2Store } from './store.js';
import { V2ToolConnector } from './tools.js';
import { AutonomousV2Agent } from './agent.js';
import { env } from '../../config/env.js';
import { createLocalDemoAgent } from './local-demo.js';
import { SupabaseInvoiceBrowserRepository } from '../../repositories/invoice-browser.repository.js';

export function createV2Agent(provider: AiProviderContract = createLiveGeminiProvider()) {
  if (env.NODE_ENV === 'development' && !env.SUPABASE_URL && !env.SUPABASE_SECRET_KEY) {
    return createLocalDemoAgent(provider);
  }
  const store=new SupabaseV2Store();
  const connector=new V2ToolConnector({store,access:new TenantAccessService(createServiceRoleAuthorizationGateway()),
    runtime:new CopilotRuntime(undefined,undefined,provider,{verifiedPreferencesOnly:true}),reads:createConversationalTools(provider),
    estimates:new SupabaseEstimateBrowserRepository(),invoices:new SupabaseInvoiceBrowserRepository(),erp:new SupabaseErpService(),pricing:new DefaultPricingService(new SupabaseRateListRepository())});
  return new AutonomousV2Agent(provider,connector,store);
}

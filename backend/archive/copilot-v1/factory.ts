import { UnifiedCopilotAgent } from './agent.js';
import { BasicInventoryModel } from './basic-inventory-model.js';
import { ProviderAgentModel } from './model.js';
import { createConversationalTools } from '../../src/ai-copilot/agent/factory.js';
import { hasConfiguredAiProvider } from '../../src/ai/providers/factory.js';
import type { ToolCallingAiProvider } from '../../src/ai/providers/contracts.js';
export function createUnifiedAgent(provider?: ToolCallingAiProvider): UnifiedCopilotAgent {
  const advanced = provider || hasConfiguredAiProvider() ? new ProviderAgentModel(provider) : undefined;
  return new UnifiedCopilotAgent(new BasicInventoryModel(advanced), createConversationalTools(provider));
}

export type AssistantIntent =
  | "reporting.query"
  | "customer.lookup"
  | "vendor.lookup"
  | "product.lookup"
  | "invoice.lookup"
  | "estimate.lookup"
  | "purchase.lookup"
  | "receivable.lookup"
  | "payable.lookup"
  | "inventory.lookup"
  | "estimate.create_draft"
  | "invoice.create_draft"
  | "customer_return.create_draft"
  | "supplier_bill.create_draft"
  | "inventory.adjust_draft";

export type AssistantDecision = "answer" | "draft" | "clarify";

export interface AssistantRequest {
  userId: string;
  organizationId: string;
  message: string;
  locale?: string;
}

export interface AssistantIntentResult {
  intent: AssistantIntent | null;
  decision: AssistantDecision;
  confidence: number;
  entities: Record<string, string>;
  clarification?: string;
}

export interface AssistantResponse {
  decision: AssistantDecision;
  intent: AssistantIntent | null;
  confidence: number;
  message: string;
  requiresConfirmation: boolean;
  entities: Record<string, string>;
}

export interface AssistantIntentResolver {
  resolve(message: string): AssistantIntentResult;
}

export interface AssistantActionGateway {
  executeRead(intent: AssistantIntent, context: AssistantRequest, entities: Record<string, string>): Promise<string>;
  createDraft(intent: AssistantIntent, context: AssistantRequest, entities: Record<string, string>): Promise<string>;
}

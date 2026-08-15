import type { AuthorizationService } from "../auth/authorization.service.js";
import type { PermissionCode } from "../auth/authorization.types.js";
import type { AssistantActionGateway, AssistantIntent, AssistantIntentResolver, AssistantRequest, AssistantResponse } from "./assistant.types.js";

const INTENT_PERMISSION: Record<AssistantIntent, PermissionCode> = {
  "reporting.query": "reports.view",
  "customer.lookup": "customers.read",
  "vendor.lookup": "vendors.read",
  "product.lookup": "products.read",
  "invoice.lookup": "sales.read",
  "estimate.lookup": "sales.read",
  "purchase.lookup": "purchases.read",
  "receivable.lookup": "reports.view",
  "payable.lookup": "reports.view",
  "inventory.lookup": "inventory.read",
  "estimate.create_draft": "sales.create",
  "invoice.create_draft": "sales.create",
  "customer_return.create_draft": "returns.create",
  "supplier_bill.create_draft": "purchases.create",
  "inventory.adjust_draft": "inventory.adjust",
};

export class AssistantService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly resolver: AssistantIntentResolver,
    private readonly gateway: AssistantActionGateway,
  ) {}

  async handle(request: AssistantRequest): Promise<AssistantResponse> {
    const resolved = this.resolver.resolve(request.message);

    if (!resolved.intent) {
      return {
        decision: "clarify",
        intent: null,
        confidence: resolved.confidence,
        message: resolved.clarification ?? "Please clarify your request.",
        requiresConfirmation: false,
        entities: resolved.entities,
      };
    }

    const permission = INTENT_PERMISSION[resolved.intent];
    await this.authorization.assertPermission(request.userId, request.organizationId, permission);

    if (resolved.decision === "draft") {
      const message = await this.gateway.createDraft(resolved.intent, request, resolved.entities);
      return {
        decision: "draft",
        intent: resolved.intent,
        confidence: resolved.confidence,
        message,
        requiresConfirmation: true,
        entities: resolved.entities,
      };
    }

    const message = await this.gateway.executeRead(resolved.intent, request, resolved.entities);
    return {
      decision: "answer",
      intent: resolved.intent,
      confidence: resolved.confidence,
      message,
      requiresConfirmation: false,
      entities: resolved.entities,
    };
  }
}

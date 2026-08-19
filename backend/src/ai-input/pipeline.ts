import { randomUUID } from "node:crypto";
import type {
  AiInputDraft,
  AiInputGateway,
  AiInputProvider,
  AiInputRequest,
  AiInputServiceContract,
} from "./ai-input.types.js";
import { assertDraftBelongsToContext, transitionDraftStatus } from "./draft-lifecycle.js";
import { validateAiInputRequest, validateExtractedFields } from "./ai-input.validation.js";

export interface AiInputAuditEvent {
  type: "draft.created" | "draft.confirmed";
  draftId: string;
  organizationId: string;
  userId: string;
  timestamp: string;
}

export interface AiInputAuditSink {
  record(event: AiInputAuditEvent): Promise<void>;
}

export class InMemoryAiInputGateway implements AiInputGateway {
  private readonly drafts = new Map<string, AiInputDraft>();

  async saveDraft(draft: AiInputDraft): Promise<AiInputDraft> {
    this.drafts.set(draft.draftId, structuredClone(draft));
    return structuredClone(draft);
  }

  async getDraft(draftId: string): Promise<AiInputDraft | undefined> {
    const draft = this.drafts.get(draftId);
    return draft ? structuredClone(draft) : undefined;
  }
}

export class NoopAiInputAuditSink implements AiInputAuditSink {
  async record(_event: AiInputAuditEvent): Promise<void> {}
}

function requireNonBlank(value: string, field: string): void {
  if (!value?.trim()) throw new Error(`${field} is required`);
}

export class AiInputPipeline implements AiInputServiceContract {
  constructor(
    private readonly provider: AiInputProvider,
    private readonly gateway: AiInputGateway,
    private readonly audit: AiInputAuditSink = new NoopAiInputAuditSink(),
  ) {}

  async createDraft(request: AiInputRequest): Promise<AiInputDraft> {
    validateAiInputRequest(request);
    const extracted = await this.provider.extract(request);

    validateExtractedFields(extracted.fields);
    if (extracted.organizationId !== request.organizationId) {
      throw new Error("AI provider returned a draft for a different organization");
    }
    if (extracted.source !== request.source) {
      throw new Error("AI provider returned a draft for a different input source");
    }
    if (extracted.intent !== request.intent) {
      throw new Error("AI provider returned a draft for a different intent");
    }

    const draft: AiInputDraft = {
      // Draft identity and authenticated ownership are server-authoritative.
      draftId: randomUUID(),
      source: request.source,
      intent: request.intent,
      organizationId: request.organizationId,
      userId: request.userId,
      status: "draft",
      fields: extracted.fields,
      requiresConfirmation: true,
    };

    const saved = await this.gateway.saveDraft(draft);
    await this.audit.record({
      type: "draft.created",
      draftId: saved.draftId,
      organizationId: saved.organizationId,
      userId: saved.userId,
      timestamp: new Date().toISOString(),
    });
    return saved;
  }

  async validateDraft(draftId: string, organizationId: string): Promise<AiInputDraft> {
    requireNonBlank(draftId, "draftId");
    requireNonBlank(organizationId, "organizationId");
    const current = await this.gateway.getDraft(draftId);
    if (!current) throw new Error("AI input draft not found");
    assertDraftBelongsToContext(current, organizationId);
    const validated = transitionDraftStatus(current, "validated");
    return this.gateway.saveDraft(validated);
  }

  async confirmDraft(draftId: string, organizationId: string, userId: string): Promise<void> {
    requireNonBlank(draftId, "draftId");
    requireNonBlank(organizationId, "organizationId");
    requireNonBlank(userId, "userId");
    const current = await this.gateway.getDraft(draftId);
    if (!current) throw new Error("AI input draft not found");
    assertDraftBelongsToContext(current, organizationId);
    if (current.userId !== userId) {
      throw new Error("AI input draft user ownership mismatch");
    }
    if (current.status !== "validated") {
      throw new Error("AI input draft must be validated before confirmation");
    }

    const confirmed = transitionDraftStatus(current, "confirmed");
    await this.gateway.saveDraft(confirmed);
    await this.audit.record({
      type: "draft.confirmed",
      draftId,
      organizationId,
      userId,
      timestamp: new Date().toISOString(),
    });
  }
}

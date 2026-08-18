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

export class AiInputPipeline implements AiInputServiceContract {
  constructor(
    private readonly provider: AiInputProvider,
    private readonly gateway: AiInputGateway,
    private readonly audit: AiInputAuditSink = new NoopAiInputAuditSink(),
  ) {}

  async createDraft(request: AiInputRequest): Promise<AiInputDraft> {
    validateAiInputRequest(request);
    const extracted = await this.provider.extract(request);

    if (extracted.organizationId !== request.organizationId) {
      throw new Error("AI provider returned a draft for a different organization");
    }

    validateExtractedFields(extracted.fields);

    const draft: AiInputDraft = {
      ...extracted,
      draftId: extracted.draftId || randomUUID(),
      status: "draft",
      requiresConfirmation: true,
    };

    const saved = await this.gateway.saveDraft(draft);
    await this.audit.record({
      type: "draft.created",
      draftId: saved.draftId,
      organizationId: saved.organizationId,
      userId: request.userId,
      timestamp: new Date().toISOString(),
    });
    return saved;
  }

  async validateDraft(draftId: string, organizationId: string): Promise<AiInputDraft> {
    const current = await this.gateway.getDraft(draftId);
    if (!current) throw new Error("AI input draft not found");
    assertDraftBelongsToContext(current, organizationId);
    const validated = transitionDraftStatus(current, "validated");
    return this.gateway.saveDraft(validated);
  }

  async confirmDraft(draftId: string, organizationId: string, userId: string): Promise<void> {
    const current = await this.gateway.getDraft(draftId);
    if (!current) throw new Error("AI input draft not found");
    assertDraftBelongsToContext(current, organizationId);
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

import type { AiInputIntent, AiInputRequest, AiInputSource, ExtractedField } from "./ai-input.types.js";

const AI_INPUT_SOURCES: readonly AiInputSource[] = ["text", "image", "camera", "voice"];
const AI_INPUT_INTENTS: readonly AiInputIntent[] = [
  "estimate.create",
  "invoice.create",
  "customer_return.create",
  "supplier_bill.create",
  "inventory.adjust",
  "rate_list.import",
];

export function assertValidConfidence(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("AI extraction confidence must be between 0 and 1");
  }
}

export function validateAiInputRequest(request: AiInputRequest): void {
  if (!request.organizationId?.trim() || !request.userId?.trim()) {
    throw new Error("AI input requires authenticated organization and user context");
  }

  if (!AI_INPUT_SOURCES.includes(request.source)) {
    throw new Error("Unsupported AI input source");
  }

  if (!AI_INPUT_INTENTS.includes(request.intent)) {
    throw new Error("Unsupported AI input intent");
  }

  if (request.source === "text" && !request.text?.trim()) {
    throw new Error("Text inputs require text");
  }

  if (request.source === "voice" && !request.text?.trim() && !request.media) {
    throw new Error("Voice inputs require transcribed text or audio media");
  }

  if ((request.source === "image" || request.source === "camera") && !request.mediaReference?.trim() && !request.media) {
    throw new Error("Image and camera inputs require a media reference or media");
  }
}

export function validateExtractedFields(fields: Record<string, ExtractedField>): void {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("AI provider fields must be an object");
  }

  for (const field of Object.values(fields)) {
    if (!field || typeof field !== "object") {
      throw new Error("AI provider returned a malformed extracted field");
    }
    assertValidConfidence(field.confidence);
    if (!AI_INPUT_SOURCES.includes(field.source)) {
      throw new Error("AI provider returned an unsupported field source");
    }
  }
}

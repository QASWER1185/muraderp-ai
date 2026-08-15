import type { AiInputRequest, ExtractedField } from "./ai-input.types.js";

export function assertValidConfidence(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("AI extraction confidence must be between 0 and 1");
  }
}

export function validateAiInputRequest(request: AiInputRequest): void {
  if (!request.organizationId || !request.userId) {
    throw new Error("AI input requires authenticated organization and user context");
  }

  if ((request.source === "text" || request.source === "voice") && !request.text?.trim()) {
    throw new Error("Text and voice inputs require transcribed text");
  }

  if ((request.source === "image" || request.source === "camera") && !request.mediaReference) {
    throw new Error("Image and camera inputs require a media reference");
  }
}

export function validateExtractedFields(fields: Record<string, ExtractedField>): void {
  for (const field of Object.values(fields)) {
    assertValidConfidence(field.confidence);
  }
}

import type { AssistantRequest } from "./assistant.types.js";

export function validateAssistantRequest(request: AssistantRequest): void {
  if (!request.userId.trim()) throw new Error("userId is required");
  if (!request.organizationId.trim()) throw new Error("organizationId is required");
  if (!request.message.trim()) throw new Error("message is required");
  if (request.message.length > 4000) throw new Error("message exceeds maximum length");
}

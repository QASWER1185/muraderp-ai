/* Phase 22 AI Experience — safe client-side orchestration surface. */
const AI_INPUT_TYPES = Object.freeze(["text", "voice", "image"]);
const AI_ACTIONS = Object.freeze(["estimate", "invoice", "purchase", "return", "inventory_adjustment"]);

export function normalizeAiRequest({ inputType = "text", text = "", rateListId = null, action = "estimate" } = {}) {
  if (!AI_INPUT_TYPES.includes(inputType)) throw new Error("Unsupported AI input type.");
  if (!AI_ACTIONS.includes(action)) throw new Error("Unsupported AI action.");
  const normalizedText = String(text).trim();
  if (!normalizedText) throw new Error("AI instruction is required.");
  return { inputType, text: normalizedText, rateListId: rateListId || null, action };
}

export function buildAiReview(request) {
  const normalized = normalizeAiRequest(request);
  return {
    status: "review_required",
    action: normalized.action,
    inputType: normalized.inputType,
    instruction: normalized.text,
    rateListId: normalized.rateListId,
    confirmationRequired: true,
    note: normalized.rateListId
      ? "The selected Rate List will be resolved by the authoritative pricing service."
      : "Pricing will be resolved only by the authoritative pricing service; AI must not invent a rate."
  };
}

export function getAiExperienceActions() {
  return [...AI_ACTIONS];
}

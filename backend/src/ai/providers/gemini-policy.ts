import { ApiError } from "../../errors/api-error.js";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/";
export function configuredGeminiModel(value: string | undefined): string {
  const model = value?.trim().replace(/^models\//, "");
  if (!model || !/^[A-Za-z0-9._-]+$/.test(model)) {
    throw new ApiError(503, "AI_NOT_CONFIGURED", "Configure GEMINI_MODEL with a verified available model.");
  }
  return model;
}
export function geminiGenerateUrl(model: string): string {
  return `${GEMINI_BASE_URL}models/${configuredGeminiModel(model)}:generateContent`;
}
export function assertGeminiEndpoint(url: URL): void {
  if (url.hostname === "generativelanguage.googleapis.com" &&
      (url.origin !== "https://generativelanguage.googleapis.com" ||
       !/^\/v1beta\/models\/[A-Za-z0-9._-]+:generateContent$/.test(url.pathname) || url.search || url.hash)) {
    throw new ApiError(503, "AI_NOT_CONFIGURED", "Gemini requires the native v1beta endpoint.");
  }
}

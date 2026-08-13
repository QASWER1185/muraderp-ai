import type { EstimateLayoutDefinition, BusinessHeaderProfile } from "./estimate-layout.types.js";
import type { EstimateDocument } from "./estimate-document.types.js";

export interface EstimateRenderModel {
  header: BusinessHeaderProfile;
  layout: EstimateLayoutDefinition;
  estimate: EstimateDocument;
  generated_at: string;
}

export function buildEstimateRenderModel(
  estimate: EstimateDocument,
  layout: EstimateLayoutDefinition,
  header: BusinessHeaderProfile,
  generatedAt: string,
): EstimateRenderModel {
  return {
    header,
    layout,
    estimate,
    generated_at: generatedAt,
  };
}

import { DEFAULT_BUSINESS_HEADER, DEFAULT_ESTIMATE_LAYOUTS, type BusinessHeaderProfile, type EstimateLayoutKey } from "../types/estimate-layout.types.js";
import type { EstimateDocument } from "../types/estimate-document.types.js";
import { buildEstimateRenderModel, type EstimateRenderModel } from "../types/estimate-render.types.js";

export interface EstimateRenderService {
  buildModel(estimate: EstimateDocument, layoutKey?: EstimateLayoutKey, header?: BusinessHeaderProfile): EstimateRenderModel;
}

export class DefaultEstimateRenderService implements EstimateRenderService {
  buildModel(
    estimate: EstimateDocument,
    layoutKey: EstimateLayoutKey = "CLASSIC_PAKISTAN",
    header: BusinessHeaderProfile = DEFAULT_BUSINESS_HEADER,
  ): EstimateRenderModel {
    const layout = DEFAULT_ESTIMATE_LAYOUTS.find((item) => item.key === layoutKey);
    if (!layout) throw new Error(`unknown estimate layout: ${layoutKey}`);

    return buildEstimateRenderModel(estimate, layout, header, new Date().toISOString());
  }
}

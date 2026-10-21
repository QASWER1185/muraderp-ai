import {
  DEFAULT_ESTIMATE_LAYOUTS,
  type EstimateLayoutDefinition,
  type EstimateLayoutKey,
} from "../types/estimate-layout.types.js";

export interface EstimateLayoutService {
  listLayouts(): readonly EstimateLayoutDefinition[];
  getLayout(key: EstimateLayoutKey): EstimateLayoutDefinition;
}

export class DefaultEstimateLayoutService implements EstimateLayoutService {
  listLayouts(): readonly EstimateLayoutDefinition[] {
    return DEFAULT_ESTIMATE_LAYOUTS;
  }

  getLayout(key: EstimateLayoutKey): EstimateLayoutDefinition {
    const layout = DEFAULT_ESTIMATE_LAYOUTS.find((item) => item.key === key);
    if (!layout) throw new Error(`unsupported estimate layout: ${key}`);
    return layout;
  }
}

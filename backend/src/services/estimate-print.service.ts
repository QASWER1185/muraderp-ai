import type { EstimateDocument } from "../types/estimate-document.types.js";
import { DEFAULT_BUSINESS_HEADER, DEFAULT_ESTIMATE_LAYOUTS, type BusinessHeaderProfile, type EstimateLayoutKey } from "../types/estimate-layout.types.js";
import { buildEstimateRenderModel } from "../types/estimate-render.types.js";
import { buildPrintableEstimate, type EstimateOutputFormat, type PrintableEstimateDocument } from "../types/estimate-print.types.js";

export class DefaultEstimatePrintService {
  buildPrintable(
    estimate: EstimateDocument,
    format: EstimateOutputFormat,
    layoutKey: EstimateLayoutKey = "CLASSIC_PAKISTAN",
    header: BusinessHeaderProfile = DEFAULT_BUSINESS_HEADER,
  ): PrintableEstimateDocument {
    const layout = DEFAULT_ESTIMATE_LAYOUTS.find((item) => item.key === layoutKey);
    if (!layout) throw new Error(`unknown estimate layout: ${layoutKey}`);

    const model = buildEstimateRenderModel(
      estimate,
      layout,
      header,
      new Date().toISOString(),
    );

    return buildPrintableEstimate(model, format);
  }
}

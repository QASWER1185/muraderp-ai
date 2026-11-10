import { DEFAULT_BUSINESS_HEADER, DEFAULT_ESTIMATE_LAYOUTS } from "../types/estimate-layout.types.js";
import { buildEstimateRenderModel } from "../types/estimate-render.types.js";
import { buildPrintableEstimate } from "../types/estimate-print.types.js";
export class DefaultEstimatePrintService {
    buildPrintable(estimate, format, layoutKey = "CLASSIC_PAKISTAN", header = DEFAULT_BUSINESS_HEADER) {
        const layout = DEFAULT_ESTIMATE_LAYOUTS.find((item) => item.key === layoutKey);
        if (!layout)
            throw new Error(`unknown estimate layout: ${layoutKey}`);
        const model = buildEstimateRenderModel(estimate, layout, header, new Date().toISOString());
        return buildPrintableEstimate(model, format);
    }
}
//# sourceMappingURL=estimate-print.service.js.map
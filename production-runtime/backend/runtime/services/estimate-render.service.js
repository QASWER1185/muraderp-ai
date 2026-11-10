import { DEFAULT_BUSINESS_HEADER, DEFAULT_ESTIMATE_LAYOUTS } from "../types/estimate-layout.types.js";
import { buildEstimateRenderModel } from "../types/estimate-render.types.js";
export class DefaultEstimateRenderService {
    buildModel(estimate, layoutKey = "CLASSIC_PAKISTAN", header = DEFAULT_BUSINESS_HEADER) {
        const layout = DEFAULT_ESTIMATE_LAYOUTS.find((item) => item.key === layoutKey);
        if (!layout)
            throw new Error(`unknown estimate layout: ${layoutKey}`);
        return buildEstimateRenderModel(estimate, layout, header, new Date().toISOString());
    }
}
//# sourceMappingURL=estimate-render.service.js.map
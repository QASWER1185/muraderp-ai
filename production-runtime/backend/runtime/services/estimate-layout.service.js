import { DEFAULT_ESTIMATE_LAYOUTS, } from "../types/estimate-layout.types.js";
export class DefaultEstimateLayoutService {
    listLayouts() {
        return DEFAULT_ESTIMATE_LAYOUTS;
    }
    getLayout(key) {
        const layout = DEFAULT_ESTIMATE_LAYOUTS.find((item) => item.key === key);
        if (!layout)
            throw new Error(`unsupported estimate layout: ${key}`);
        return layout;
    }
}
//# sourceMappingURL=estimate-layout.service.js.map
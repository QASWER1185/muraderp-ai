export function getEstimateActions(status) {
    const draft = status === "DRAFT";
    const ready = status === "READY";
    const active = draft || ready;
    return [
        { action: "SAVE_DRAFT", enabled: draft },
        { action: "MARK_READY", enabled: draft },
        { action: "PRINT", enabled: active },
        { action: "SHARE_WHATSAPP", enabled: active },
        { action: "CONVERT_TO_QUOTATION", enabled: ready },
    ];
}
//# sourceMappingURL=estimate-action.types.js.map
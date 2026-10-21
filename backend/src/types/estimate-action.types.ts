export type EstimateAction = "SAVE_DRAFT" | "MARK_READY" | "PRINT" | "SHARE_WHATSAPP" | "CONVERT_TO_QUOTATION";

export interface EstimateActionAvailability {
  action: EstimateAction;
  enabled: boolean;
  reason?: string;
}

export function getEstimateActions(status: "DRAFT" | "READY" | "CONVERTED" | "CANCELLED"): EstimateActionAvailability[] {
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

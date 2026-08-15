export type PurchaseInputSourceType = "TEXT" | "IMAGE" | "VOICE";
export type PurchaseDraftApprovalStatus = "DRAFT" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED";

export interface PurchaseInputSource {
  type: PurchaseInputSourceType;
  reference?: string | null;
  locale?: string | null;
}

export interface PurchaseDraftLine {
  product_query: string;
  product_id?: number | null;
  quantity: number;
  unit?: string | null;
  unit_cost?: number | null;
  confidence: number;
}

export interface PurchaseDraft {
  source: PurchaseInputSource;
  vendor_query?: string | null;
  vendor_id?: number | null;
  purchase_date?: string | null;
  invoice_number?: string | null;
  lines: PurchaseDraftLine[];
  notes?: string | null;
  overall_confidence: number;
  approval_status: PurchaseDraftApprovalStatus;
}

export interface PurchaseInputAdapter {
  extract(source: PurchaseInputSource, payload: unknown): Promise<PurchaseDraft>;
}

/**
 * AI/OCR/voice adapters produce proposals only. Posting remains the
 * responsibility of the authoritative purchase service after validation and
 * explicit approval.
 */
export interface PurchaseDraftApproval {
  approve(draft: PurchaseDraft): Promise<PurchaseDraft>;
}

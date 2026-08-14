/**
 * Compatibility layer only.
 *
 * Canonical sales-offer document: Estimate.
 * In MuradERP-AI, "Quotation" is a user-facing synonym for Estimate,
 * not a separate database/domain entity.
 */
import type { EstimateDefinition, EstimateDocument, EstimateDraft } from "./estimate-document.types.js";

export type QuotationStatus = EstimateDocument["status"];
export type QuotationDefinition = EstimateDefinition;
export type QuotationDraft = EstimateDraft;
export type QuotationDocument = EstimateDocument;

/** @deprecated Use EstimateDefinition and EstimateDocument directly. */
export function buildQuotationFromEstimate(
  estimate: EstimateDocument,
  definition: QuotationDefinition,
  _id = 0,
): QuotationDocument {
  return {
    ...estimate,
    definition,
  };
}

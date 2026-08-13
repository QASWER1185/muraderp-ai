import type { EstimateDefinition, EstimateDocument, EstimateDraft, EstimateStatus } from "./estimate-document.types.js";

/**
 * Estimate and Quotation are the same commercial document in MuradERP-AI.
 * "Estimate" and "Quotation" are presentation/business-language aliases,
 * not separate database entities or lifecycle domains.
 */
export type QuotationStatus = EstimateStatus;
export type QuotationDefinition = EstimateDefinition;
export type QuotationDocument = EstimateDocument;
export type QuotationDraft = EstimateDraft;

export function buildQuotationFromEstimate(
  estimate: EstimateDocument,
  _definition?: QuotationDefinition,
  _id = estimate.id,
): QuotationDocument {
  return {
    ...estimate,
    id: _id,
  };
}

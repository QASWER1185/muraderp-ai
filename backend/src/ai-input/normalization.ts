import type { AiInputDraft, ExtractedField } from "./ai-input.types.js";

export interface NormalizedLine {
  productName?: string;
  productId?: string;
  quantity?: number;
  unit?: string;
  brandHint?: string;
  rateListHint?: string;
  unitRate?: number;
}

const normalizeText = (value: string): string => value.trim().replace(/\s+/g, " ");

function normalizeOptionalText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function normalizeOptionalPositiveNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a finite number greater than zero`);
  }
  return value;
}

function normalizeOptionalNonNegativeNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite number zero or greater`);
  }
  return value;
}

export function normalizeField<T>(field?: ExtractedField<T>): T | undefined {
  if (!field) return undefined;
  return typeof field.value === "string" ? (normalizeText(field.value) as T) : field.value;
}

export function normalizeDraftLines(draft: AiInputDraft): NormalizedLine[] {
  const linesField = draft.fields.lines?.value;
  if (!Array.isArray(linesField)) return [];

  return linesField.map((line, index) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      throw new Error(`AI input line ${index} must be an object`);
    }

    const candidate = line as Record<string, unknown>;
    const read = (key: string): unknown => {
      const value = candidate[key];
      if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) {
        return (value as { value?: unknown }).value;
      }
      return value;
    };

    const normalized: NormalizedLine = {};
    const productName = normalizeOptionalText(read("productName"), "productName");
    const productId = normalizeOptionalText(read("productId"), "productId");
    const quantity = normalizeOptionalPositiveNumber(read("quantity"), "quantity");
    const unit = normalizeOptionalText(read("unit"), "unit");
    const brandHint = normalizeOptionalText(read("brandHint"), "brandHint");
    const rateListHint = normalizeOptionalText(read("rateListHint"), "rateListHint");
    const unitRate = normalizeOptionalNonNegativeNumber(read("unitRate"), "unitRate");

    if (productName !== undefined) normalized.productName = productName;
    if (productId !== undefined) normalized.productId = productId;
    if (quantity !== undefined) normalized.quantity = quantity;
    if (unit !== undefined) normalized.unit = unit;
    if (brandHint !== undefined) normalized.brandHint = brandHint;
    if (rateListHint !== undefined) normalized.rateListHint = rateListHint;
    if (unitRate !== undefined) normalized.unitRate = unitRate;

    return normalized;
  });
}

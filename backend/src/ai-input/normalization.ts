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

export function normalizeField<T>(field?: ExtractedField<T>): T | undefined {
  if (!field) return undefined;
  return typeof field.value === "string" ? (normalizeText(field.value) as T) : field.value;
}

export function normalizeDraftLines(draft: AiInputDraft): NormalizedLine[] {
  const linesField = draft.fields.lines?.value;
  if (!Array.isArray(linesField)) return [];

  return linesField.map((line) => {
    const candidate = (line ?? {}) as Record<string, unknown>;
    const read = <T>(key: string): T | undefined => {
      const value = candidate[key];
      if (value && typeof value === "object" && "value" in value) {
        return normalizeField(value as ExtractedField<T>);
      }
      return typeof value === "string" ? (normalizeText(value) as T) : (value as T | undefined);
    };

    const normalized: NormalizedLine = {};
    const productName = read<string>("productName");
    const productId = read<string>("productId");
    const quantity = read<number>("quantity");
    const unit = read<string>("unit");
    const brandHint = read<string>("brandHint");
    const rateListHint = read<string>("rateListHint");
    const unitRate = read<number>("unitRate");

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

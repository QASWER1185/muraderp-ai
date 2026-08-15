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

    return {
      productName: read<string>("productName"),
      productId: read<string>("productId"),
      quantity: read<number>("quantity"),
      unit: read<string>("unit"),
      brandHint: read<string>("brandHint"),
      rateListHint: read<string>("rateListHint"),
      unitRate: read<number>("unitRate"),
    };
  });
}

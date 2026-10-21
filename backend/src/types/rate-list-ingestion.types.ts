export type RateListIngestionSource = "MANUAL" | "IMAGE_OCR" | "VOICE";

export interface RateListIngestionRow {
  row_number: number;
  product_name: string;
  product_code?: string | null;
  brand_hint?: string | null;
  unit: string;
  unit_price: number;
  minimum_quantity?: number;
}

export interface RateListIngestionDraft {
  rate_list_id: number;
  version_number: number;
  source: RateListIngestionSource;
  source_reference?: string | null;
  rows: RateListIngestionRow[];
}

export interface ValidatedRateListIngestionDraft extends RateListIngestionDraft {
  rows: RateListIngestionRow[];
}

export function validateRateListIngestionDraft(
  draft: RateListIngestionDraft,
): ValidatedRateListIngestionDraft {
  if (!Number.isInteger(draft.rate_list_id) || draft.rate_list_id <= 0) {
    throw new Error("rate_list_id must be a positive integer");
  }
  if (!Number.isInteger(draft.version_number) || draft.version_number <= 0) {
    throw new Error("version_number must be a positive integer");
  }
  if (!Array.isArray(draft.rows) || draft.rows.length === 0) {
    throw new Error("rate-list import must contain at least one row");
  }

  const rowNumbers = new Set<number>();
  const productKeys = new Set<string>();

  for (const row of draft.rows) {
    if (!Number.isInteger(row.row_number) || row.row_number <= 0) {
      throw new Error("row_number must be a positive integer");
    }
    if (rowNumbers.has(row.row_number)) {
      throw new Error(`duplicate row_number ${row.row_number}`);
    }
    rowNumbers.add(row.row_number);

    if (!row.product_name.trim()) {
      throw new Error(`product_name is required on row ${row.row_number}`);
    }
    if (!row.unit.trim()) {
      throw new Error(`unit is required on row ${row.row_number}`);
    }
    if (!Number.isFinite(row.unit_price) || row.unit_price < 0) {
      throw new Error(`unit_price must be zero or greater on row ${row.row_number}`);
    }

    const minimumQuantity = row.minimum_quantity ?? 1;
    if (!Number.isFinite(minimumQuantity) || minimumQuantity <= 0) {
      throw new Error(`minimum_quantity must be greater than zero on row ${row.row_number}`);
    }

    const identity = `${(row.product_code ?? row.product_name).trim().toLowerCase()}|${minimumQuantity}`;
    if (productKeys.has(identity)) {
      throw new Error(`duplicate product/quantity tier on row ${row.row_number}`);
    }
    productKeys.add(identity);
  }

  return {
    ...draft,
    rows: draft.rows.map((row) => ({
      ...row,
      product_name: row.product_name.trim(),
      product_code: row.product_code?.trim() || null,
      brand_hint: row.brand_hint?.trim() || null,
      unit: row.unit.trim(),
      minimum_quantity: row.minimum_quantity ?? 1,
    })),
  };
}

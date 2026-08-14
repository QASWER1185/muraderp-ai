import { describe, expect, it } from "vitest";
import { validateRateListIngestionDraft } from "./rate-list-ingestion.types.js";

describe("rate-list ingestion validation", () => {
  it("accepts manual, image OCR, and voice sources", () => {
    for (const source of ["MANUAL", "IMAGE_OCR", "VOICE"] as const) {
      const result = validateRateListIngestionDraft({
        rate_list_id: 10,
        version_number: 2,
        source,
        rows: [
          {
            row_number: 1,
            product_name: "25mm Pipe",
            product_code: "P25",
            brand_hint: "Popular",
            unit: "piece",
            unit_price: 1250,
          },
        ],
      });

      expect(result.source).toBe(source);
      expect(result.rows[0]?.minimum_quantity).toBe(1);
    }
  });

  it("preserves a brand hint for mixed-brand OCR/voice imports", () => {
    const result = validateRateListIngestionDraft({
      rate_list_id: 10,
      version_number: 1,
      source: "IMAGE_OCR",
      rows: [
        { row_number: 1, product_name: "Pipe 25mm", brand_hint: "Dura", unit: "piece", unit_price: 1000 },
        { row_number: 2, product_name: "Elbow 25mm", brand_hint: "HE", unit: "piece", unit_price: 120 },
      ],
    });

    expect(result.rows.map((row) => row.brand_hint)).toEqual(["Dura", "HE"]);
  });

  it("rejects duplicate rows before any persistence is allowed", () => {
    expect(() => validateRateListIngestionDraft({
      rate_list_id: 10,
      version_number: 1,
      source: "MANUAL",
      rows: [
        { row_number: 1, product_name: "Pipe 25mm", unit: "piece", unit_price: 1000 },
        { row_number: 1, product_name: "Elbow 25mm", unit: "piece", unit_price: 120 },
      ],
    })).toThrow("duplicate row_number 1");
  });

  it("rejects negative prices and invalid quantities", () => {
    expect(() => validateRateListIngestionDraft({
      rate_list_id: 10,
      version_number: 1,
      source: "VOICE",
      rows: [{ row_number: 1, product_name: "Pipe", unit: "piece", unit_price: -1 }],
    })).toThrow("unit_price must be zero or greater on row 1");

    expect(() => validateRateListIngestionDraft({
      rate_list_id: 10,
      version_number: 1,
      source: "VOICE",
      rows: [{ row_number: 1, product_name: "Pipe", unit: "piece", unit_price: 1000, minimum_quantity: 0 }],
    })).toThrow("minimum_quantity must be greater than zero on row 1");
  });
});

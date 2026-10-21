import { ApiError } from "../errors/api-error.js";
import { normalizeDocumentDate, parseDocumentNumber } from "../ai-input/document-numbers.js";
import { RateListCatalogPageSchema, rateListCatalogItemSchema, type RateListCatalog } from "./rate-list-catalog.js";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Salvage observations row by row. Missing rates are never converted to zero. */
export function normalizeCatalogPage(raw: unknown, partial = false): RateListCatalog {
  if (!record(raw) || raw.documentType !== "rate_list" || !Array.isArray(raw.items)) {
    throw new ApiError(422, "AI_INVALID_OUTPUT", "No readable catalog rows were returned.");
  }
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.filter((w): w is string => typeof w === "string").map(w => w.slice(0, 500)) : [];
  const items: RateListCatalog["items"] = [];
  let unpriced = 0, invalid = 0;
  for (const row of raw.items) {
    if (!record(row)) { invalid++; continue; }
    const price = parseDocumentNumber(row.list_price).value;
    if (price === null) { unpriced++; continue; }
    const item = rateListCatalogItemSchema.safeParse({
      brand: row.brand, category: row.category, name: row.name, size: row.size, unit: row.unit, list_price: price,
      ...(row.discountPercent == null ? {} : { discountPercent: parseDocumentNumber(row.discountPercent).value }),
    });
    if (item.success) items.push(item.data); else invalid++;
  }
  if (unpriced) warnings.push(`Skipped ${unpriced} row(s) with blank, dashed, or unreadable prices; no price was inferred.`);
  if (invalid) warnings.push(`Skipped ${invalid} row(s) with incomplete product details or invalid discounts.`);
  if (partial) warnings.push("Partial response recovered: only complete item records were retained.");
  const discount = parseDocumentNumber(raw.standardDiscountPercent).value;
  const standardDiscountPercent = discount !== null && discount <= 100 ? discount : null;
  if (raw.standardDiscountPercent != null && standardDiscountPercent === null) warnings.push("Unreadable standard discount was not applied.");
  const date = typeof raw.effectiveDate === "string" ? normalizeDocumentDate(raw.effectiveDate) : { value: null, issue: null };
  if (date.issue) warnings.push(date.issue);
  const result = RateListCatalogPageSchema.safeParse({
    documentType: "rate_list", name: raw.name, ...(date.value ? { effectiveDate: date.value } : {}), items,
    standardDiscountPercent, complete: raw.complete === true && !partial && !unpriced && !invalid,
    confidence: typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? Math.max(0, Math.min(1, raw.confidence)) : .5,
    warnings: [...new Set(warnings)],
  });
  if (!result.success) throw new ApiError(422, "AI_INVALID_OUTPUT", "The catalog heading could not be read. Please upload a clearer price list.");
  return result.data;
}

// Return the end of a *closed* JSON value. Quotes, escapes and nested objects
// are tracked so a brace/comma inside a product name is never a row boundary.
function closedValue(text: string, start: number): number | null {
  let quoted = false, escaped = false;
  const stack: string[] = [];
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') { quoted = false; if (!stack.length) return i + 1; }
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") {
      const open = stack.pop();
      if ((c === "}" && open !== "{") || (c === "]" && open !== "[")) return null;
      if (!stack.length) return i + 1;
    } else if (!stack.length && /[,\s]/.test(c)) return i;
  }
  return null;
}

/** Repair a truncated items array by dropping its unfinished tail, never by
 * completing a row, number, string, or product field. Metadata must precede it. */
export function recoverCatalogPage(raw: unknown): RateListCatalog {
  if (typeof raw !== "string") return normalizeCatalogPage(raw, true);
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return normalizeCatalogPage(JSON.parse(text), true); } catch { /* Try a closed prefix. */ }
  if (!text.startsWith("{")) throw new ApiError(422, "AI_INVALID_OUTPUT", "No readable catalog rows were returned.");
  let cursor = 1;
  const skip = () => { while (/\s/.test(text[cursor] ?? "") && cursor < text.length) cursor++; };
  while (cursor < text.length) {
    skip(); if (text[cursor] !== '"') break;
    const keyEnd = closedValue(text, cursor); if (keyEnd === null) break;
    const key: unknown = JSON.parse(text.slice(cursor, keyEnd)); cursor = keyEnd; skip();
    if (text[cursor++] !== ":") break;
    skip();
    if (key === "items" && text[cursor] === "[") {
      const header = JSON.parse(text.slice(0, cursor) + "[]}") as Record<string, unknown>;
      const items: unknown[] = []; cursor++;
      while (cursor < text.length) {
        skip(); if (text[cursor] !== "{") break;
        const end = closedValue(text, cursor); if (end === null) break;
        try { items.push(JSON.parse(text.slice(cursor, end))); } catch { break; }
        cursor = end; skip(); if (text[cursor++] !== ",") break;
      }
      return normalizeCatalogPage({ ...header, items }, true);
    }
    const end = closedValue(text, cursor); if (end === null) break;
    cursor = end; skip(); if (text[cursor++] !== ",") break;
  }
  throw new ApiError(422, "AI_INVALID_OUTPUT", "No complete catalog item records could be recovered.");
}

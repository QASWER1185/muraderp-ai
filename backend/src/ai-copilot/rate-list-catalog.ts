import { z } from "zod";
import { ApiError } from "../errors/api-error.js";

const text = z.string().trim().min(1).max(200);
export const rateListCatalogItemSchema = z.strictObject({
  brand: text, category: z.enum(["Pipes", "Fittings", "Hardware"]), name: text,
  size: text, unit: z.string().trim().min(1).max(50), list_price: z.number().finite().nonnegative(),
  discountPercent: z.number().finite().min(0).max(100).optional(),
});
// Catalog observations have no customer, ordered quantities or invoice totals.
export const RateListCatalogSchema = z.strictObject({
  documentType: z.enum(["rate_list"]), name: text,
  effectiveDate: z.iso.date().optional(),
  items: z.array(rateListCatalogItemSchema).min(1),
  standardDiscountPercent: z.number().finite().min(0).max(100).nullable(),
  complete: z.boolean(), confidence: z.number().min(0).max(1),
  warnings: z.array(z.string().max(500)),
});
export type RateListCatalog = z.infer<typeof RateListCatalogSchema>;
// A cover, notes page, or page with only unavailable prices may have no rows.
// The merged import still requires at least one validated priced item.
export const RateListCatalogPageSchema = RateListCatalogSchema.omit({ items: true }).extend({ items: z.array(rateListCatalogItemSchema) });
export type RateListCatalogImport = RateListCatalog & { organization_id: string; idempotency_key: string };
export function isRateListRequest(text: string): boolean {
  return /rate\s*list|price\s*list|catalog(?:ue)?|ریٹ\s*لسٹ|پرائس\s*لسٹ|نرخ\s*نامہ|darj\s*(?:kar|ker|karein)|درج\s*کر/i.test(text);
}
export function mergeCatalogPages(pages: RateListCatalog[]): RateListCatalog {
  const first = pages[0];
  if (!first) throw new ApiError(422, "CATALOG_NO_PRICED_ITEMS", "No readable priced items were found. Please upload a clearer price list.");
  const items = new Map<string, RateListCatalog["items"][number]>();
  const conflicts = new Set<string>();
  for (const page of pages) for (const item of page.items) {
    const key = [item.brand, item.category, item.name, item.size, item.unit].map(value => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ")).join("|");
    const previous = items.get(key);
    if (previous && (previous.list_price !== item.list_price || previous.discountPercent !== item.discountPercent)) {
      conflicts.add(key); items.delete(key);
    }
    if (!conflicts.has(key)) items.set(key, item);
  }
  if (!items.size) throw new ApiError(422, "CATALOG_NO_PRICED_ITEMS", "No unambiguous priced items were found. Please upload a clearer price list.");
  const discounts = new Set(pages.flatMap(page => page.standardDiscountPercent === null ? [] : [page.standardDiscountPercent]));
  const complete = pages.every(page => page.complete) && !conflicts.size && discounts.size <= 1;
  return { ...first, items: [...items.values()], complete, standardDiscountPercent: discounts.size === 1 ? [...discounts][0]! : null,
    confidence: Math.min(...pages.map(page => page.confidence)), warnings: [...new Set([
      ...pages.flatMap(page => page.warnings),
      ...(!complete ? ["Partial catalog: the preview contains only validated priced items. Review the omitted rows before saving."] : []),
      ...(conflicts.size ? [`Skipped ${conflicts.size} item(s) with conflicting printed prices or discounts.`] : []),
      ...(discounts.size > 1 ? ["Conflicting page discounts were not applied; printed list prices are preserved."] : []),
    ])] };
}

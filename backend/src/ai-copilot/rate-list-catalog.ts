import { z } from "zod";
import { ApiError } from "../errors/api-error.js";

const text = z.string().trim().min(1).max(200);
export const rateListCatalogItemSchema = z.strictObject({
  brand: text, category: z.enum(["Pipes", "Fittings", "Hardware"]), name: text,
  size: text, unit: z.string().trim().min(1).max(50), list_price: z.number().finite().nonnegative(),
});
// Catalog observations have no customer, ordered quantities or invoice totals.
export const RateListCatalogSchema = z.strictObject({
  documentType: z.enum(["rate_list"]), name: text,
  items: z.array(rateListCatalogItemSchema).min(1),
  standardDiscountPercent: z.number().finite().min(0).max(100).nullable(),
  complete: z.boolean(), confidence: z.number().min(0).max(1),
  warnings: z.array(z.string().max(500)),
});
export type RateListCatalog = z.infer<typeof RateListCatalogSchema>;
export type RateListCatalogImport = RateListCatalog & { organization_id: string; idempotency_key: string };
export function isRateListRequest(text: string): boolean {
  return /rate\s*list|price\s*list|catalog(?:ue)?|ریٹ\s*لسٹ|پرائس\s*لسٹ|نرخ\s*نامہ|darj\s*(?:kar|ker|karein)|درج\s*کر/i.test(text);
}
export function mergeCatalogPages(pages: RateListCatalog[]): RateListCatalog {
  const first = pages[0];
  if (!first || pages.some(page => !page.complete)) throw new ApiError(422, "CATALOG_INCOMPLETE", "The catalog extraction is incomplete. No import was prepared. Please retry the document.");
  const items = new Map<string, RateListCatalog["items"][number]>();
  for (const page of pages) for (const item of page.items) {
    const key = [item.brand, item.category, item.name, item.size, item.unit].map(value => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ")).join("|");
    const previous = items.get(key);
    if (previous && previous.list_price !== item.list_price) throw new ApiError(422, "CATALOG_CONFLICT", `Conflicting printed rates for ${item.name} ${item.size}. No import was prepared.`);
    items.set(key, item);
  }
  const discounts = new Set(pages.flatMap(page => page.standardDiscountPercent === null ? [] : [page.standardDiscountPercent]));
  if (discounts.size > 1) throw new ApiError(422, "CATALOG_CONFLICT", "The catalog pages contain conflicting standard discounts.");
  return { ...first, items: [...items.values()], standardDiscountPercent: [...discounts][0] ?? null,
    confidence: Math.min(...pages.map(page => page.confidence)), warnings: [...new Set(pages.flatMap(page => page.warnings))] };
}

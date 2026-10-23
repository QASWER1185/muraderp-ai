import { canonicalSlipWords, canonicalUnit } from "./conversationalMunshi.js";
import { canonicalBrand, canonicalCatalogQuery } from "./productResolver.js";

export const SHOP_DISCOUNTS: Record<string, number> = { "Dura Max": 50, Popular: 41, "Turk Plast": 45, "HE China": 35 };

/** Resolve shop defaults without inventing packing counts or changing diameters. */
export function shopItem<T extends { name?: string; unit?: string; brand?: string }>(item: T, brand?: string): T {
  if (!item.name) return item;
  let name = canonicalSlipWords(item.name);
  if (/\b(?:solvent|cement solution)\b/i.test(name) && !/\d\s*(?:g|gm|grams?|kg|کلو)/iu.test(name)) name += " 500g";
  name = canonicalCatalogQuery(name, brand ?? item.brand);
  return { ...item, name };
}

export function shopDiscount(brand?: string): number {
  return brand ? SHOP_DISCOUNTS[canonicalBrand(brand)] ?? 0 : 0;
}

export function correctionNote(raw: string | undefined, name: string): string | undefined {
  return raw && /ایلو|البو|ٹی\s*ساکٹ/u.test(raw)
    ? "جناب، پرچی کے لفظ [" + raw + "] کو " + name + " کے طور پر شامل کر دیا گیا ہے۔" : undefined;
}

export function pipeUnitCompatible(name: string, requested: string, catalog: string): boolean {
  return /\bpipe\b|پائپ/iu.test(name) && ["pcs", "length"].includes(canonicalUnit(requested)) && ["pcs", "length"].includes(canonicalUnit(catalog));
}

export function counterTotals(totals: { subtotal: number; discount_total: number; grand_total: number; customer_payable_total: number }) {
  const cashPayable = Math.round(totals.customer_payable_total);
  return { gross_total: totals.subtotal, trade_discount: totals.discount_total, net_total: totals.grand_total,
    round_off: Math.round((cashPayable - totals.customer_payable_total) * 100) / 100, cash_payable: cashPayable };
}

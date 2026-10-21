import { describe, expect, it, vi } from "vitest";
import { DefaultPricingService, type PricingRepository, type RateListHintResolver } from "./pricing.service.js";
import type { PriceResolutionContext, PricingCandidate, ResolvedPrice } from "../types/pricing.types.js";
import type { RateListRecord } from "../repositories/rate-list.repository.js";

const resolved: ResolvedPrice = { rate_list_id: 7, rate_list_version_id: 8, rate_list_item_id: 9, product_id: 25, unit_price: 185, unit: "pcs", currency_code: "PKR", minimum_quantity: 1, scope_type: "GLOBAL", effective_from: "2026-08-15T00:00:00Z" };
const base: Omit<PriceResolutionContext, "product_id" | "quantity" | "rate_list_id"> = { organization_id: "11111111-1111-4111-8111-111111111111", price_type: "SALE", as_of: "2026-08-15T12:00:00Z" };

function repo(value: ResolvedPrice | null): PricingRepository { return { findBestRateListItem: vi.fn(async () => value) }; }
function list(id: number, name: string): RateListRecord { return { id, organization_id: "11111111-1111-4111-8111-111111111111", name, code: name.toUpperCase().replaceAll(" ", "-"), price_type: "SALE", scope_type: "GLOBAL", vendor_id: null, customer_id: null, currency_code: "PKR", is_active: true, created_at: "2026-08-15T00:00:00Z", updated_at: "2026-08-15T00:00:00Z" }; }

describe("Phase 17 pricing candidate resolution", () => {
  it("uses the user-selected rate list automatically", async () => {
    const pricingRepository = repo(resolved);
    const service = new DefaultPricingService(pricingRepository);
    const candidate: PricingCandidate = { product_id: 25, quantity: 50, selected_rate_list_id: 7, selection_source: "ESTIMATE_DEFAULT" };
    await expect(service.resolveCandidate(candidate, base)).resolves.toEqual(resolved);
    expect(pricingRepository.findBestRateListItem).toHaveBeenCalledWith(expect.objectContaining({ product_id: 25, quantity: 50, rate_list_id: 7 }));
  });

  it("maps an explicit brand/rate-list hint to one matching list", async () => {
    const pricingRepository = repo(resolved);
    const hintResolver: RateListHintResolver = { findRateListsByHint: vi.fn(async () => [list(7, "Popular")]) };
    const service = new DefaultPricingService(pricingRepository, hintResolver);
    await expect(service.resolveCandidate({ product_id: 25, quantity: 50, rate_list_hint: "Popular", selection_source: "OCR_BRAND_MATCH" }, base)).resolves.toEqual(resolved);
    expect(pricingRepository.findBestRateListItem).toHaveBeenCalledWith(expect.objectContaining({ rate_list_id: 7 }));
  });

  it("does not guess when a brand/rate-list hint is ambiguous", async () => {
    const pricingRepository = repo(resolved);
    const hintResolver: RateListHintResolver = { findRateListsByHint: vi.fn(async () => [list(7, "Popular"), list(8, "Popular")]) };
    const service = new DefaultPricingService(pricingRepository, hintResolver);
    await expect(service.resolveCandidate({ product_id: 25, quantity: 50, rate_list_hint: "Popular", selection_source: "VOICE_BRAND_MATCH" }, base)).resolves.toBeNull();
    expect(pricingRepository.findBestRateListItem).not.toHaveBeenCalled();
  });

  it("falls back to the selected list when the explicit hint is not found", async () => {
    const pricingRepository = repo(resolved);
    const hintResolver: RateListHintResolver = { findRateListsByHint: vi.fn(async () => []) };
    const service = new DefaultPricingService(pricingRepository, hintResolver);
    await expect(service.resolveCandidate({ product_id: 25, quantity: 50, selected_rate_list_id: 7, rate_list_hint: "Unknown Brand", selection_source: "OCR_BRAND_MATCH" }, base)).resolves.toEqual(resolved);
  });
});

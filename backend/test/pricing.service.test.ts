import { describe, expect, it, vi } from "vitest";
import { DefaultPricingService } from "../src/services/pricing.service.js";
import type { PriceResolutionContext, PricingCandidate, ResolvedPrice } from "../src/types/pricing.types.js";

const validContext: PriceResolutionContext = {
  organization_id: "11111111-1111-4111-8111-111111111111",
  price_type: "SALE",
  product_id: 10,
  quantity: 5,
  as_of: "2026-08-13T10:00:00Z",
  customer_id: 7,
};

const resolved: ResolvedPrice = {
  rate_list_id: 1,
  rate_list_version_id: 2,
  rate_list_item_id: 3,
  product_id: 10,
  unit_price: 1400,
  unit: "bag",
  currency_code: "PKR",
  minimum_quantity: 1,
  scope_type: "CUSTOMER",
  effective_from: "2026-08-13T00:00:00Z",
};

describe("DefaultPricingService", () => {
  it("delegates valid resolution requests to the repository", async () => {
    const repository = { findBestRateListItem: vi.fn().mockResolvedValue(resolved) };
    const service = new DefaultPricingService(repository);
    await expect(service.resolvePrice(validContext)).resolves.toEqual(resolved);
    expect(repository.findBestRateListItem).toHaveBeenCalledWith(validContext);
  });

  it("returns null when the repository has no applicable price", async () => {
    const repository = { findBestRateListItem: vi.fn().mockResolvedValue(null) };
    const service = new DefaultPricingService(repository);
    await expect(service.resolvePrice(validContext)).resolves.toBeNull();
  });

  it.each([
    [{ ...validContext, organization_id: "not-an-organization" }, "organization_id must be a valid UUID"],
    [{ ...validContext, product_id: 0 }, "product_id must be a positive integer"],
    [{ ...validContext, product_id: 1.5 }, "product_id must be a positive integer"],
    [{ ...validContext, quantity: 0 }, "quantity must be greater than zero"],
    [{ ...validContext, quantity: Number.NaN }, "quantity must be greater than zero"],
    [{ ...validContext, as_of: "not-a-date" }, "as_of must be a valid date/time"],
    [{ ...validContext, rate_list_id: 0 }, "rate_list_id must be a positive integer when provided"],
  ] as const)("rejects invalid context: %s", async (context, message) => {
    const repository = { findBestRateListItem: vi.fn() };
    const service = new DefaultPricingService(repository);
    await expect(service.resolvePrice(context)).rejects.toThrow(message);
    expect(repository.findBestRateListItem).not.toHaveBeenCalled();
  });

  it("passes an explicit rate-list selection through unchanged", async () => {
    const repository = { findBestRateListItem: vi.fn().mockResolvedValue(resolved) };
    const service = new DefaultPricingService(repository);
    const context = { ...validContext, rate_list_id: 1 };
    await expect(service.resolvePrice(context)).resolves.toEqual(resolved);
    expect(repository.findBestRateListItem).toHaveBeenCalledWith(context);
  });

  it("rejects a repository result from a different explicit rate list", async () => {
    const repository = { findBestRateListItem: vi.fn().mockResolvedValue(resolved) };
    const service = new DefaultPricingService(repository);
    const context = { ...validContext, rate_list_id: 99 };
    await expect(service.resolvePrice(context)).rejects.toThrow("resolved price does not belong to the requested rate list");
  });

  it.each([
    [{ ...resolved, unit_price: Number.NaN }, "resolved unit_price must be a finite non-negative number"],
    [{ ...resolved, unit_price: Number.POSITIVE_INFINITY }, "resolved unit_price must be a finite non-negative number"],
    [{ ...resolved, minimum_quantity: 0 }, "resolved minimum_quantity must be a finite positive number"],
    [{ ...resolved, product_id: 99 }, "resolved price product does not match the requested product"],
    [{ ...resolved, effective_from: "not-a-date" }, "resolved effective_from must be a valid date/time"],
    [{ ...resolved, unit: "   " }, "resolved price unit is required"],
  ] as const)("rejects malformed repository output: %s", async (repositoryResult, message) => {
    const repository = { findBestRateListItem: vi.fn().mockResolvedValue(repositoryResult) };
    const service = new DefaultPricingService(repository);
    await expect(service.resolvePrice(validContext)).rejects.toThrow(message);
  });

  it("rejects an invalid runtime selection source and malformed selected rate-list id", async () => {
    const repository = { findBestRateListItem: vi.fn().mockResolvedValue(resolved) };
    const service = new DefaultPricingService(repository);
    const base: Omit<PricingCandidate, "selection_source"> = { product_id: 10, quantity: 5 };
    await expect(service.resolveCandidate({ ...base, selection_source: "HACK" as PricingCandidate["selection_source"] }, validContext)).rejects.toThrow("candidate selection_source is invalid");
    await expect(service.resolveCandidate({ ...base, selected_rate_list_id: Number.NaN, selection_source: "MANUAL_OVERRIDE" }, validContext)).rejects.toThrow("candidate selected_rate_list_id must be a positive integer when provided");
  });

  it("does not silently combine a conflicting rate-list hint with explicit selection", async () => {
    const repository = { findBestRateListItem: vi.fn().mockResolvedValue(resolved) };
    const hintResolver = { findRateListsByHint: vi.fn().mockResolvedValue([{ ...resolved, name: "Customer List", code: "CUST" }]) };
    const service = new DefaultPricingService(repository, hintResolver);
    const candidate: PricingCandidate = { product_id: 10, quantity: 5, selected_rate_list_id: 99, rate_list_hint: "CUST", selection_source: "MANUAL_OVERRIDE" };
    await expect(service.resolveCandidate(candidate, validContext)).resolves.toBeNull();
    expect(repository.findBestRateListItem).not.toHaveBeenCalled();
  });
});

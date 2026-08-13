import type {
  PriceResolutionContext,
  RateListDefinition,
  RateListItemDefinition,
  RateListVersionDefinition,
  ResolvedPrice,
} from "../types/pricing.types.js";

export interface PricingRepository {
  findBestRateListItem(
    context: PriceResolutionContext,
  ): Promise<ResolvedPrice | null>;
}

export interface PricingService {
  resolvePrice(context: PriceResolutionContext): Promise<ResolvedPrice | null>;
}

/**
 * Deterministic pricing application service.
 *
 * Selection precedence belongs to the repository because it is a database
 * ordering concern. The service owns the stable application boundary and
 * validates the business input before resolution.
 */
export class DefaultPricingService implements PricingService {
  constructor(private readonly repository: PricingRepository) {}

  async resolvePrice(context: PriceResolutionContext): Promise<ResolvedPrice | null> {
    if (!Number.isInteger(context.product_id) || context.product_id <= 0) {
      throw new Error("product_id must be a positive integer");
    }

    if (!Number.isFinite(context.quantity) || context.quantity <= 0) {
      throw new Error("quantity must be greater than zero");
    }

    if (!context.as_of || Number.isNaN(Date.parse(context.as_of))) {
      throw new Error("as_of must be a valid date/time");
    }

    return this.repository.findBestRateListItem(context);
  }
}

export type { RateListDefinition, RateListItemDefinition, RateListVersionDefinition };

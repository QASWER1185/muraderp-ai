import type {
  PriceResolutionContext,
  RateListDefinition,
  RateListItemDefinition,
  RateListVersionDefinition,
  ResolvedPrice,
} from "../types/pricing.types.js";

export interface PricingRepository {
  findBestRateListItem(context: PriceResolutionContext): Promise<ResolvedPrice | null>;
}

export interface PricingService {
  resolvePrice(context: PriceResolutionContext): Promise<ResolvedPrice | null>;
}

/**
 * Deterministic pricing application service.
 *
 * When a rate_list_id is supplied, the repository must resolve only from that
 * rate list. This service also verifies the returned authority so a faulty
 * adapter can never silently substitute another rate list.
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

    if (context.rate_list_id != null && (!Number.isInteger(context.rate_list_id) || context.rate_list_id <= 0)) {
      throw new Error("rate_list_id must be a positive integer when provided");
    }

    const resolved = await this.repository.findBestRateListItem(context);

    if (resolved && context.rate_list_id != null && resolved.rate_list_id !== context.rate_list_id) {
      throw new Error("resolved price does not belong to the requested rate list");
    }

    return resolved;
  }
}

export type { RateListDefinition, RateListItemDefinition, RateListVersionDefinition };

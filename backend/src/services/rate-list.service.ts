import type {
  RateListDefinition,
  RateListItemDefinition,
  RateListVersionDefinition,
} from "../types/pricing.types.js";

export interface RateListRepository {
  createRateList(input: RateListDefinition): Promise<{ id: number } & RateListDefinition>;
  createVersion(input: RateListVersionDefinition): Promise<{ id: number } & RateListVersionDefinition>;
  replaceVersionItems(
    versionId: number,
    items: RateListItemDefinition[],
  ): Promise<RateListItemDefinition[]>;
}

export interface RateListService {
  createRateList(input: RateListDefinition): Promise<{ id: number } & RateListDefinition>;
  createVersion(input: RateListVersionDefinition): Promise<{ id: number } & RateListVersionDefinition>;
  replaceVersionItems(versionId: number, items: RateListItemDefinition[]): Promise<RateListItemDefinition[]>;
}

/**
 * Application boundary for rate-list authoring.
 *
 * A version is authored separately from activation. This keeps imported or
 * AI/OCR-extracted rates in a draftable state until a user or controlled
 * workflow explicitly publishes them.
 */
export class DefaultRateListService implements RateListService {
  constructor(private readonly repository: RateListRepository) {}

  async createRateList(input: RateListDefinition) {
    if (!input.name.trim()) throw new Error("rate list name is required");
    if (!input.code.trim()) throw new Error("rate list code is required");
    if (!input.currency_code.trim()) throw new Error("currency_code is required");

    if (input.scope_type === "GLOBAL" && (input.vendor_id != null || input.customer_id != null)) {
      throw new Error("global rate lists cannot have vendor_id or customer_id");
    }
    if (input.scope_type === "VENDOR" && (!Number.isInteger(input.vendor_id) || input.vendor_id! <= 0 || input.customer_id != null)) {
      throw new Error("vendor rate lists require a valid vendor_id and no customer_id");
    }
    if (input.scope_type === "CUSTOMER" && (!Number.isInteger(input.customer_id) || input.customer_id! <= 0 || input.vendor_id != null)) {
      throw new Error("customer rate lists require a valid customer_id and no vendor_id");
    }

    return this.repository.createRateList(input);
  }

  async createVersion(input: RateListVersionDefinition) {
    if (!Number.isInteger(input.rate_list_id) || input.rate_list_id <= 0) {
      throw new Error("rate_list_id must be a positive integer");
    }
    if (!Number.isInteger(input.version_number) || input.version_number <= 0) {
      throw new Error("version_number must be a positive integer");
    }
    if (!input.effective_from || Number.isNaN(Date.parse(input.effective_from))) {
      throw new Error("effective_from must be a valid date/time");
    }
    if (input.effective_to != null && Date.parse(input.effective_to) <= Date.parse(input.effective_from)) {
      throw new Error("effective_to must be later than effective_from");
    }

    return this.repository.createVersion(input);
  }

  async replaceVersionItems(versionId: number, items: RateListItemDefinition[]) {
    if (!Number.isInteger(versionId) || versionId <= 0) {
      throw new Error("versionId must be a positive integer");
    }

    const seen = new Set<string>();
    for (const item of items) {
      if (!Number.isInteger(item.product_id) || item.product_id <= 0) {
        throw new Error("each rate-list item requires a valid product_id");
      }
      if (!Number.isFinite(item.minimum_quantity ?? 1) || (item.minimum_quantity ?? 1) <= 0) {
        throw new Error("minimum_quantity must be greater than zero");
      }
      if (!Number.isFinite(item.unit_price) || item.unit_price < 0) {
        throw new Error("unit_price must be zero or greater");
      }
      if (!item.unit.trim()) throw new Error("unit is required");

      const key = `${item.product_id}:${item.minimum_quantity ?? 1}`;
      if (seen.has(key)) throw new Error(`duplicate rate-list tier: ${key}`);
      seen.add(key);
    }

    return this.repository.replaceVersionItems(versionId, items);
  }
}

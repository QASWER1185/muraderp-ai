import type {
  RateListDefinition,
  RateListItemDefinition,
  RateListVersionDefinition,
} from "../types/pricing.types.js";
import type {
  RateListItemRecord,
  RateListRecord,
  RateListRepository,
  RateListVersionRecord,
} from "../repositories/rate-list.repository.js";

export interface RateListService {
  createRateList(input: RateListDefinition): Promise<RateListRecord>;
  createVersion(input: RateListVersionDefinition): Promise<RateListVersionRecord>;
  createItem(input: RateListItemDefinition): Promise<RateListItemRecord>;
}

/**
 * Application boundary for rate-list authoring.
 *
 * Versions and items are authored independently so imported or AI/OCR-extracted
 * rates can remain in a draft version until a controlled publication workflow
 * activates the version.
 */
export class DefaultRateListService implements RateListService {
  constructor(private readonly repository: RateListRepository) {}

  async createRateList(input: RateListDefinition): Promise<RateListRecord> {
    const name = input.name.trim();
    const code = input.code.trim();
    const currencyCode = input.currency_code.trim().toUpperCase();

    if (!name) throw new Error("rate list name is required");
    if (!code) throw new Error("rate list code is required");
    if (!currencyCode) throw new Error("currency_code is required");

    if (input.scope_type === "GLOBAL" && (input.vendor_id != null || input.customer_id != null)) {
      throw new Error("global rate lists cannot have vendor_id or customer_id");
    }
    if (
      input.scope_type === "VENDOR" &&
      (!Number.isInteger(input.vendor_id) || input.vendor_id! <= 0 || input.customer_id != null)
    ) {
      throw new Error("vendor rate lists require a valid vendor_id and no customer_id");
    }
    if (
      input.scope_type === "CUSTOMER" &&
      (!Number.isInteger(input.customer_id) || input.customer_id! <= 0 || input.vendor_id != null)
    ) {
      throw new Error("customer rate lists require a valid customer_id and no vendor_id");
    }

    return this.repository.createRateList({
      ...input,
      name,
      code,
      currency_code: currencyCode,
    });
  }

  async createVersion(input: RateListVersionDefinition): Promise<RateListVersionRecord> {
    if (!Number.isInteger(input.rate_list_id) || input.rate_list_id <= 0) {
      throw new Error("rate_list_id must be a positive integer");
    }
    if (!Number.isInteger(input.version_number) || input.version_number <= 0) {
      throw new Error("version_number must be a positive integer");
    }
    if (!input.effective_from || Number.isNaN(Date.parse(input.effective_from))) {
      throw new Error("effective_from must be a valid date/time");
    }
    if (input.effective_to != null) {
      if (Number.isNaN(Date.parse(input.effective_to))) {
        throw new Error("effective_to must be a valid date/time");
      }
      if (Date.parse(input.effective_to) <= Date.parse(input.effective_from)) {
        throw new Error("effective_to must be later than effective_from");
      }
    }

    return this.repository.createVersion(input);
  }

  async createItem(input: RateListItemDefinition): Promise<RateListItemRecord> {
    if (!Number.isInteger(input.rate_list_version_id) || input.rate_list_version_id <= 0) {
      throw new Error("rate_list_version_id must be a positive integer");
    }
    if (!Number.isInteger(input.product_id) || input.product_id <= 0) {
      throw new Error("product_id must be a positive integer");
    }

    const minimumQuantity = input.minimum_quantity ?? 1;
    if (!Number.isFinite(minimumQuantity) || minimumQuantity <= 0) {
      throw new Error("minimum_quantity must be greater than zero");
    }
    if (!Number.isFinite(input.unit_price) || input.unit_price < 0) {
      throw new Error("unit_price must be zero or greater");
    }

    const unit = input.unit.trim();
    if (!unit) throw new Error("unit is required");

    return this.repository.createItem({
      ...input,
      minimum_quantity: minimumQuantity,
      unit,
    });
  }
}

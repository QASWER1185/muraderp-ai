import type { RateListPickerOption } from "../types/rate-list-picker.types.js";
import type { RateListRepository } from "../repositories/rate-list.repository.js";

export class EstimateRateListPickerService {
  constructor(private readonly repository: RateListRepository) {}

  async getSaleRateListOptions(): Promise<RateListPickerOption[]> {
    const lists = await this.repository.listActiveSaleRateLists();
    return lists.map((list) => ({
      id: list.id,
      name: list.name,
      code: list.code,
      price_type: list.price_type,
      currency_code: list.currency_code,
      is_active: list.is_active,
    }));
  }
}

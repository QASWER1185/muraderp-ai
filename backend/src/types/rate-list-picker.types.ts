export interface RateListPickerOption {
  id: number;
  name: string;
  code: string;
  price_type: "PURCHASE" | "SALE";
  currency_code: string;
  is_active: boolean;
}

export interface EstimateRateListPicker {
  default_rate_list_id?: number | null;
  options: RateListPickerOption[];
}

export function filterSelectableRateLists(
  options: RateListPickerOption[],
  priceType: "PURCHASE" | "SALE" = "SALE",
): RateListPickerOption[] {
  return options.filter((option) => option.is_active && option.price_type === priceType);
}

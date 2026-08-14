export type RateListPriceType = "PURCHASE" | "SALE";

export type RateListScopeType = "GLOBAL" | "VENDOR" | "CUSTOMER";

export type RateListVersionStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export type RateListSelectionSource =
  | "ESTIMATE_DEFAULT"
  | "LINE_OVERRIDE"
  | "OCR_BRAND_MATCH"
  | "MANUAL_OVERRIDE";

export interface RateListDefinition {
  name: string;
  code: string;
  price_type: RateListPriceType;
  scope_type: RateListScopeType;
  vendor_id?: number | null | undefined;
  customer_id?: number | null | undefined;
  currency_code: string;
  is_active?: boolean | undefined;
}

export interface RateListVersionDefinition {
  rate_list_id: number;
  version_number: number;
  status?: RateListVersionStatus | undefined;
  effective_from: string;
  effective_to?: string | null | undefined;
}

export interface RateListItemDefinition {
  rate_list_version_id: number;
  product_id: number;
  minimum_quantity?: number | undefined;
  unit_price: number;
  unit: string;
}

export interface PriceResolutionContext {
  price_type: RateListPriceType;
  product_id: number;
  quantity: number;
  as_of: string;
  vendor_id?: number | null | undefined;
  customer_id?: number | null | undefined;
  /** When present, pricing must be resolved from this exact rate list. */
  rate_list_id?: number | null | undefined;
}

export interface ResolvedPrice {
  rate_list_id: number;
  rate_list_version_id: number;
  rate_list_item_id: number;
  product_id: number;
  unit_price: number;
  unit: string;
  currency_code: string;
  minimum_quantity: number;
  scope_type: RateListScopeType;
  effective_from: string;
}

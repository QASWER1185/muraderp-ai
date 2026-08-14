export interface ProductDefinition {
  name: string;
  sku: string;
  category: string;
  unit: string;
  purchase_price: number;
  sale_price: number;
  brand_id?: number | null;
}

export interface ProductRecord extends ProductDefinition {
  id: number;
  brand_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProductListFilter {
  search?: string;
  category?: string;
  brand_id?: number;
}

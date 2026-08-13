export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      brands: {
        Row: {
          created_at: string;
          id: number;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: never;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          city: string;
          created_at: string;
          id: number;
          name: string;
          phone: string;
          updated_at: string;
        };
        Insert: {
          city: string;
          created_at?: string;
          id?: never;
          name: string;
          phone: string;
          updated_at?: string;
        };
        Update: {
          city?: string;
          created_at?: string;
          id?: never;
          name?: string;
          phone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      inventory: {
        Row: {
          created_at: string;
          id: number;
          product_id: number;
          quantity: number;
          updated_at: string;
          warehouse_id: number;
        };
        Insert: {
          created_at?: string;
          id?: number;
          product_id: number;
          quantity?: number;
          updated_at?: string;
          warehouse_id: number;
        };
        Update: {
          created_at?: string;
          id?: number;
          product_id?: number;
          quantity?: number;
          updated_at?: string;
          warehouse_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_warehouse_id_fkey";
            columns: ["warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          brand_id: number | null;
          category: string;
          created_at: string;
          id: number;
          name: string;
          purchase_price: number;
          sale_price: number;
          sku: string;
          unit: string;
          updated_at: string;
        };
        Insert: {
          brand_id?: number | null;
          category: string;
          created_at?: string;
          id?: never;
          name: string;
          purchase_price: number;
          sale_price: number;
          sku: string;
          unit: string;
          updated_at?: string;
        };
        Update: {
          brand_id?: number | null;
          category?: string;
          created_at?: string;
          id?: never;
          name?: string;
          purchase_price?: number;
          sale_price?: number;
          sku?: string;
          unit?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_idempotency_keys: {
        Row: {
          completed_at: string | null;
          created_at: string;
          expires_at: string;
          id: number;
          idempotency_key: string;
          operation: string;
          principal_scope: string;
          purchase_id: number | null;
          request_fingerprint: string;
          response_body: Json | null;
          response_status: number | null;
          status: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: never;
          idempotency_key: string;
          operation: string;
          principal_scope: string;
          purchase_id?: number | null;
          request_fingerprint: string;
          response_body?: Json | null;
          response_status?: number | null;
          status?: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: never;
          idempotency_key?: string;
          operation?: string;
          principal_scope?: string;
          purchase_id?: number | null;
          request_fingerprint?: string;
          response_body?: Json | null;
          response_status?: number | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_idempotency_keys_purchase_id_fkey";
            columns: ["purchase_id"];
            isOneToOne: false;
            referencedRelation: "purchases";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_items: {
        Row: {
          created_at: string;
          id: number;
          product_id: number;
          purchase_id: number;
          quantity: number;
          total_cost: number;
          unit_cost: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: number;
          product_id: number;
          purchase_id: number;
          quantity: number;
          total_cost: number;
          unit_cost: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: number;
          product_id?: number;
          purchase_id?: number;
          quantity?: number;
          total_cost?: number;
          unit_cost?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey";
            columns: ["purchase_id"];
            isOneToOne: false;
            referencedRelation: "purchases";
            referencedColumns: ["id"];
          },
        ];
      };
      purchases: {
        Row: {
          created_at: string;
          discount: number;
          id: number;
          invoice_number: string | null;
          notes: string | null;
          purchase_date: string;
          subtotal: number;
          tax: number;
          total: number;
          updated_at: string;
          vendor_id: number;
          warehouse_id: number;
        };
        Insert: {
          created_at?: string;
          discount?: number;
          id?: number;
          invoice_number?: string | null;
          notes?: string | null;
          purchase_date?: string;
          subtotal?: number;
          tax?: number;
          total?: number;
          updated_at?: string;
          vendor_id: number;
          warehouse_id: number;
        };
        Update: {
          created_at?: string;
          discount?: number;
          id?: number;
          invoice_number?: string | null;
          notes?: string | null;
          purchase_date?: string;
          subtotal?: number;
          tax?: number;
          total?: number;
          updated_at?: string;
          vendor_id?: number;
          warehouse_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "purchases_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchases_warehouse_id_fkey";
            columns: ["warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_movements: {
        Row: {
          created_at: string;
          id: number;
          movement_type: string;
          notes: string | null;
          product_id: number;
          quantity: number;
          reference_id: number | null;
          reference_type: string | null;
          unit_cost: number | null;
          warehouse_id: number;
        };
        Insert: {
          created_at?: string;
          id?: number;
          movement_type: string;
          notes?: string | null;
          product_id: number;
          quantity: number;
          reference_id?: number | null;
          reference_type?: string | null;
          unit_cost?: number | null;
          warehouse_id: number;
        };
        Update: {
          created_at?: string;
          id?: number;
          movement_type?: string;
          notes?: string | null;
          product_id?: number;
          quantity?: number;
          reference_id?: number | null;
          reference_type?: string | null;
          unit_cost?: number | null;
          warehouse_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_warehouse_id_fkey";
            columns: ["warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      vendors: {
        Row: {
          city: string;
          created_at: string;
          id: number;
          name: string;
          phone: string;
          updated_at: string;
        };
        Insert: {
          city: string;
          created_at?: string;
          id?: never;
          name: string;
          phone: string;
          updated_at?: string;
        };
        Update: {
          city?: string;
          created_at?: string;
          id?: never;
          name?: string;
          phone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      warehouses: {
        Row: {
          created_at: string;
          id: number;
          location: string | null;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: never;
          location?: string | null;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          location?: string | null;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      record_purchase: {
        Args: {
          p_discount?: number;
          p_idempotency_key: string;
          p_idempotency_operation: string;
          p_idempotency_principal: string;
          p_invoice_number?: string;
          p_items: Json;
          p_notes?: string;
          p_purchase_date?: string;
          p_request_fingerprint: string;
          p_tax?: number;
          p_vendor_id: number;
          p_warehouse_id: number;
        };
        Returns: Json;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

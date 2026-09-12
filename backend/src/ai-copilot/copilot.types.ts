import type { AiInputIntent, AiInputSource } from "../ai-input/contracts.js";
import type { CustomerInput, VendorInput } from "../services/erp.service.js";
import type { CustomerPaymentInput } from "../services/customer-payment.service.js";
import type { VendorPaymentInput } from "../services/vendor-payment.service.js";
import type { EstimatePricingSelection } from "../types/estimate-pricing-selection.types.js";

export type CopilotTarget = AiInputIntent | "customer_create" | "vendor_create" | "rate_list_update" | "customer_payment" | "vendor_payment";
export type CopilotInputSource = AiInputSource;

export type CopilotRateSource =
  | "EXPLICIT_USER_RATE"
  | "SELECTED_RATE_LIST"
  | "UNRESOLVED_BRAND_HINT"
  | "UNRESOLVED";

export interface CopilotLineCandidate {
  productName: string;
  productId?: number;
  brandHint?: string;
  quantity: number;
  unit?: string;
  explicitUnitRate?: number;
  rateSource: CopilotRateSource;
  pricingSelection?: EstimatePricingSelection;
  sourceItemId?: number;
}

export interface CopilotActionPlan {
  organizationId: string;
  branchId?: string;
  userId: string;
  source: CopilotInputSource;
  target: CopilotTarget;
  customerId?: string;
  vendorId?: string;
  warehouseId?: number;
  documentNumber?: string;
  documentDate?: string;
  currencyCode?: string;
  reason?: string;
  customerData?: CustomerInput;
  vendorData?: VendorInput;
  rateListUpdate?: {
    rateListId: number;
    versionNumber: number;
    effectiveFrom: string;
  };
  customerPaymentData?: CustomerPaymentInput;
  vendorPaymentData?: VendorPaymentInput;
  lines: CopilotLineCandidate[];
  requiresConfirmation: true;
}

export interface CopilotPlannerInput {
  organizationId: string;
  branchId?: string;
  userId: string;
  source: CopilotInputSource;
  target: CopilotTarget;
  customerId?: string;
  vendorId?: string;
  warehouseId?: number;
  documentNumber?: string;
  documentDate?: string;
  currencyCode?: string;
  reason?: string;
  lines: Array<{
    productName: string;
    productId?: number;
    brandHint?: string;
    quantity: number;
    unit?: string;
    explicitUnitRate?: number;
    rateListId?: number;
    rateListSelectionSource?: "INHERITED" | "LINE_OVERRIDE";
    sourceItemId?: number;
  }>;
}

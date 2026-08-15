import type { AiInputIntent, AiInputSource } from "../ai-input/contracts.js";
import type { EstimatePricingSelection } from "../types/estimate-pricing-selection.types.js";

export type CopilotTarget = AiInputIntent;
export type CopilotInputSource = AiInputSource;

export type CopilotRateSource =
  | "EXPLICIT_USER_RATE"
  | "SELECTED_RATE_LIST"
  | "UNRESOLVED_BRAND_HINT"
  | "UNRESOLVED";

export interface CopilotLineCandidate {
  productName: string;
  brandHint?: string;
  quantity: number;
  unit?: string;
  explicitUnitRate?: number;
  rateSource: CopilotRateSource;
  pricingSelection?: EstimatePricingSelection;
}

export interface CopilotActionPlan {
  organizationId: string;
  userId: string;
  source: CopilotInputSource;
  target: CopilotTarget;
  customerId?: string;
  vendorId?: string;
  lines: CopilotLineCandidate[];
  requiresConfirmation: true;
}

export interface CopilotPlannerInput {
  organizationId: string;
  userId: string;
  source: CopilotInputSource;
  target: CopilotTarget;
  customerId?: string;
  vendorId?: string;
  lines: Array<{
    productName: string;
    brandHint?: string;
    quantity: number;
    unit?: string;
    explicitUnitRate?: number;
    rateListId?: number;
  }>;
}

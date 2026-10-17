import { ApiError } from "../errors/api-error.js";
import type { TenantAccessService } from "../auth/tenant-access.service.js";
import type { EstimateCloneRepriceRepository } from "./estimate-clone-reprice.service.js";
import type { ErpService } from "./erp.service.js";
import type { EstimateDocument } from "../types/estimate-document.types.js";
import type { WhatsAppEstimateDelivery } from "../types/whatsapp-share.types.js";
import { WhatsAppEstimateService } from "./whatsapp-estimate.service.js";

export interface EstimateWhatsAppShareInput {
  estimateId: number;
  organizationId: string;
  branchId: string;
  userId: string;
}

export interface EstimateWhatsAppShareService {
  prepare(input: EstimateWhatsAppShareInput): Promise<WhatsAppEstimateDelivery>;
}

export class DefaultEstimateWhatsAppShareService implements EstimateWhatsAppShareService {
  constructor(
    private readonly estimates: Pick<EstimateCloneRepriceRepository, "getEstimateAggregate">,
    private readonly customers: Pick<ErpService, "getCustomer">,
    private readonly authorization: Pick<TenantAccessService, "assertAuthorized">,
    private readonly whatsapp = new WhatsAppEstimateService(),
  ) {}

  async prepare(input: EstimateWhatsAppShareInput): Promise<WhatsAppEstimateDelivery> {
    if (!Number.isInteger(input.estimateId) || input.estimateId <= 0) throw new ApiError(400, "VALIDATION_ERROR", "A valid Estimate ID is required");
    await this.authorization.assertAuthorized(
      { userId: input.userId, organizationId: input.organizationId },
      "sales.read",
      { kind: "branch", branchId: input.branchId },
    );
    const aggregate = await this.estimates.getEstimateAggregate(input.estimateId, input.organizationId);
    if (!aggregate || aggregate.record.organization_id !== input.organizationId) throw new ApiError(404, "NOT_FOUND", "Estimate was not found");
    if (aggregate.record.branch_id !== input.branchId) throw new ApiError(403, "BRANCH_ACCESS_DENIED", "Estimate branch does not match the active branch");
    if (!aggregate.items.length) throw new ApiError(422, "EMPTY_ESTIMATE", "Estimate has no shareable lines");
    const customer = await this.customers.getCustomer(aggregate.record.customer_id, input.organizationId);
    if (!customer) throw new ApiError(404, "NOT_FOUND", "Estimate customer was not found");

    const subtotal = aggregate.items.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_price), 0);
    const discountTotal = aggregate.items.reduce((sum, line) => sum + Number(line.discount_amount ?? 0), 0);
    const grandTotal = subtotal - discountTotal;
    const rent = Number(aggregate.record.pass_through_rent ?? 0);
    const estimate: EstimateDocument = {
      id: aggregate.record.id,
      status: aggregate.record.status,
      definition: aggregate.record,
      lines: aggregate.items.map((line) => ({
        line_number: line.line_number,
        product_id: line.product_id,
        description: line.description,
        quantity: Number(line.quantity),
        unit: line.unit,
        unit_price: Number(line.unit_price),
        discount_amount: Number(line.discount_amount ?? 0),
        pricing_source: line.pricing_source,
        rate_list_id: line.rate_list_id,
        rate_list_version_id: line.rate_list_version_id,
        ...(line.brand_hint === undefined ? {} : { brand_hint: line.brand_hint }),
      })),
      totals: {
        subtotal,
        discount_total: discountTotal,
        grand_total: grandTotal,
        pass_through_rent: rent,
        customer_payable_total: grandTotal + rent,
      },
    };
    return this.whatsapp.prepareDelivery(estimate, customer.phone, aggregate.record.layout_key);
  }
}

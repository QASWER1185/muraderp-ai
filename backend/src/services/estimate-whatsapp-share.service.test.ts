import { describe, expect, it, vi } from "vitest";
import { DefaultEstimateWhatsAppShareService } from "./estimate-whatsapp-share.service.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

function fixtures() {
  const aggregate = {
    record: {
      id: 50, organization_id: organizationId, branch_id: branchId, customer_id: 7, estimate_number: "EST-50",
      issue_date: "2026-09-11", currency_code: "PKR", status: "READY", source_type: "MANUAL", source_reference: null,
      pass_through_rent: 200, layout_key: "CLASSIC_PAKISTAN", created_at: "2026-09-11T00:00:00Z", updated_at: "2026-09-11T00:00:00Z",
    },
    items: [{
      id: 1, estimate_id: 50, line_number: 1, product_id: 10, description: "Cement", quantity: 2, unit: "bag",
      unit_price: 1500, discount_amount: 100, pricing_source: "MANUAL_OVERRIDE", rate_list_id: null, rate_list_version_id: null,
      created_at: "2026-09-11T00:00:00Z", updated_at: "2026-09-11T00:00:00Z",
    }],
    source_fingerprint: "fingerprint",
  };
  return {
    estimates: { getEstimateAggregate: vi.fn().mockResolvedValue(aggregate) },
    customers: { getCustomer: vi.fn().mockResolvedValue({ id: 7, organization_id: organizationId, name: "Ali", phone: "03001234567", city: "Lahore" }) },
    authorization: { assertAuthorized: vi.fn().mockResolvedValue(undefined) },
  };
}

describe("DefaultEstimateWhatsAppShareService", () => {
  it("authorizes and prepares the owned Estimate for the customer's phone", async () => {
    const dependencies = fixtures();
    const service = new DefaultEstimateWhatsAppShareService(dependencies.estimates as never, dependencies.customers as never, dependencies.authorization);

    const result = await service.prepare({ estimateId: 50, organizationId, branchId, userId });

    expect(dependencies.authorization.assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "sales.read", { kind: "branch", branchId });
    expect(dependencies.estimates.getEstimateAggregate).toHaveBeenCalledWith(50, organizationId);
    expect(dependencies.customers.getCustomer).toHaveBeenCalledWith(7, organizationId);
    expect(result.share_url).toContain("https://wa.me/923001234567");
    expect(result.message).toContain("3100 PKR");
  });

  it("rejects a cross-branch Estimate before resolving the customer", async () => {
    const dependencies = fixtures();
    const service = new DefaultEstimateWhatsAppShareService(dependencies.estimates as never, dependencies.customers as never, dependencies.authorization);

    await expect(service.prepare({ estimateId: 50, organizationId, branchId: "44444444-4444-4444-8444-444444444444", userId }))
      .rejects.toMatchObject({ code: "BRANCH_ACCESS_DENIED" });
    expect(dependencies.customers.getCustomer).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { RateListCatalogSchema, isRateListRequest, mergeCatalogPages, type RateListCatalog } from "./rate-list-catalog.js";
import { ProviderBusinessInput } from "../ai-input/business-input.provider.js";
import { MultimodalAgentInput } from "./agent/multimodal-input.js";
import { DefaultRateListService } from "../services/rate-list.service.js";
vi.mock("../ai-input/media-validation.js", () => ({
  validateAgentMedia: vi.fn(async () => ({ bytes: Buffer.from("fixture"), mimeType: "application/pdf" })),
  visionContent: vi.fn(async () => [{ type: "input_image", image_url: "page-one" }, { type: "input_image", image_url: "page-two" }]),
}));
const scope = { organizationId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", branchId: "33333333-3333-4333-8333-333333333333" };
function page(start: number, count: number): RateListCatalog {
  return { documentType: "rate_list", name: "Dura Flow PPRC", standardDiscountPercent: 50, complete: true, confidence: .99, warnings: [],
    items: Array.from({ length: count }, (_, i) => ({ brand: "Dura Flow", category: "Pipes", name: "Pipe PN-16 13ft", size: (start + i) + "mm", unit: "length", list_price: 1527 + i })) };
}
describe("catalog classification and complete page extraction", () => {
  it.each(["rate list", "PRICE LIST", "ریٹ لسٹ", "درج کر لیں", "Dura Flow PPRC darj ker lein"])("recognizes %s", text => expect(isRateListRequest(text)).toBe(true));
  it("does not classify an ordinary invoice as a catalog", () => expect(isRateListRequest("Read this customer invoice")).toBe(false));
  it("extracts 150 rows across pages without transaction fields or message limits", async () => {
    const provider = { generate: vi.fn().mockResolvedValueOnce(page(1, 70)).mockResolvedValueOnce(page(71, 80)), transcribe: vi.fn() };
    const result = await new MultimodalAgentInput(new ProviderBusinessInput(provider)).normalize({ source: "image", media: { mimeType: "application/pdf", base64: "fixture" }, message: "Dura Flow PPRC darj ker lein", fileName: "DuraFlow PPRC Price List.pdf" }, scope);
    expect(result.catalog?.items).toHaveLength(150);
    expect(result.catalog).not.toHaveProperty("customerName");
    expect(result.message).toContain("150");
    expect(result.message).not.toContain("Untrusted extracted");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[0]?.[0]).toBe(RateListCatalogSchema);
  });
  it("auto-detects a catalog visually without a prompt hint", async () => {
    const provider = { generate: vi.fn().mockResolvedValueOnce(page(1, 60)).mockResolvedValueOnce(page(61, 72)), transcribe: vi.fn() };
    const result = await new MultimodalAgentInput(new ProviderBusinessInput(provider)).normalize({ source: "image", media: { mimeType: "application/pdf", base64: "fixture" } }, scope);
    expect(result.catalog?.items).toHaveLength(132);
  });
  it("deduplicates repeated rows and rejects conflicting prices", () => {
    expect(mergeCatalogPages([page(25, 1), page(25, 1)]).items).toHaveLength(1);
    const other = page(25, 1); other.items[0]!.list_price++;
    expect(() => mergeCatalogPages([page(25, 1), other])).toThrow("Conflicting");
  });
  it("rejects incomplete pages", () => expect(() => mergeCatalogPages([page(1, 50), { ...page(51, 50), complete: false }])).toThrow("incomplete"));
  it("validates before invoking the atomic import service", async () => {
    const importRateList = vi.fn().mockResolvedValue({ version: { status: "ACTIVE" }, items: [] });
    const service = new DefaultRateListService({ importRateList } as any);
    const catalog = page(1, 132);
    await service.importRateList({ ...catalog, organization_id: scope.organizationId, idempotency_key: "approved" });
    expect(importRateList).toHaveBeenCalledWith(expect.objectContaining({ standardDiscountPercent: 50, items: catalog.items }));
    await expect(service.importRateList({ ...catalog, complete: false, organization_id: scope.organizationId, idempotency_key: "bad" })).rejects.toThrow("incomplete");
    expect(importRateList).toHaveBeenCalledOnce();
  });
});

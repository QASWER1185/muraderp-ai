import { describe, expect, it, vi } from "vitest";
import { RateListCatalogPageSchema, isRateListRequest, mergeCatalogPages, type RateListCatalog } from "./rate-list-catalog.js";
import { normalizeCatalogPage, recoverCatalogPage } from "./catalog-extraction.js";
import { duraUpvcPages } from "./catalog.test-fixtures.js";
import { ApiError } from "../errors/api-error.js";
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
    expect(provider.generate.mock.calls[0]?.[0]).toBe(RateListCatalogPageSchema);
  });
  it("auto-detects a catalog visually without a prompt hint", async () => {
    const provider = { generate: vi.fn().mockResolvedValueOnce(page(1, 60)).mockResolvedValueOnce(page(61, 72)), transcribe: vi.fn() };
    const result = await new MultimodalAgentInput(new ProviderBusinessInput(provider)).normalize({ source: "image", media: { mimeType: "application/pdf", base64: "fixture" } }, scope);
    expect(result.catalog?.items).toHaveLength(132);
  });
  it("deduplicates repeated rows and excludes conflicting prices while retaining other products", () => {
    expect(mergeCatalogPages([page(25, 1), page(25, 1)]).items).toHaveLength(1);
    const other = page(25, 1); other.items[0]!.list_price++;
    const result=mergeCatalogPages([page(25, 2), other]);
    expect(result.items).toHaveLength(1);expect(result.items[0]!.size).toBe("26mm");expect(result.complete).toBe(false);
    expect(result.warnings.join(" ")).toContain("conflicting");
  });
  it("retains valid rows from incomplete pages with visible warnings", () => {
    const result=mergeCatalogPages([page(1, 50), { ...page(51, 50), complete: false }]);
    expect(result.items).toHaveLength(100);expect(result.complete).toBe(false);expect(result.warnings.join(" ")).toContain("Partial catalog");
  });
  it("does not guess a discount when page discounts conflict",()=>{
    const result=mergeCatalogPages([page(1,1),{...page(2,1),standardDiscountPercent:42}]);
    expect(result.items).toHaveLength(2);expect(result.standardDiscountPercent).toBeNull();expect(result.warnings.join(" ")).toContain("discounts were not applied");
  });
  it("recovers all 85 priced U-PVC variants from both pages and excludes the three dash cells",async()=>{
    const [first,second]=duraUpvcPages();
    const provider={generate:vi.fn().mockResolvedValueOnce({...first,complete:false}).mockResolvedValueOnce(second),transcribe:vi.fn()};
    const result=await new MultimodalAgentInput(new ProviderBusinessInput(provider)).normalize({source:"image",media:{mimeType:"application/pdf",base64:"fixture"},fileName:"Dura Max U-PVC Price List 29.09.2026.pdf"},scope);
    expect(result.catalog?.items).toHaveLength(85);expect(result.catalog?.items.filter(row=>row.category==="Pipes")).toHaveLength(39);
    expect(result.catalog?.items.every(row=>row.list_price>0)).toBe(true);expect(result.catalog?.complete).toBe(false);
    expect(result.message).toBe("ڈیورا یو پی وی سی کے 85 درست آئٹمز کامیابی سے نکال لیے گئے ہیں۔ کیا انہیں ERP ریٹ لسٹ میں محفوظ کر دیا جائے؟");
    expect(result.catalog?.warnings.join(" ")).toContain("Skipped 3");
    for(const call of provider.generate.mock.calls)expect((call[2] as any[]).filter(part=>part.type==="input_image")).toHaveLength(1);
    expect(JSON.stringify(provider.generate.mock.calls[1]?.[2])).toContain("Previous page catalog heading");
  });
  it.each([0,1])("preserves the readable page if page %s has no recoverable output",async failed=>{
    const provider={generate:vi.fn(),transcribe:vi.fn()};
    if(failed===0)provider.generate.mockRejectedValueOnce(new ApiError(422,"AI_INCOMPLETE","cut off")).mockResolvedValueOnce(page(2,2));
    else provider.generate.mockResolvedValueOnce(page(1,2)).mockRejectedValueOnce(new ApiError(422,"AI_INVALID_OUTPUT","cut off"));
    const result=await new MultimodalAgentInput(new ProviderBusinessInput(provider)).normalize({source:"image",media:{mimeType:"application/pdf",base64:"fixture"},task:"rate_list_update"},scope);
    expect(result.catalog?.items).toHaveLength(2);expect(result.catalog?.warnings.join(" ")).toContain(`Page ${failed+1} could not be read`);
  });
  it("validates before invoking the atomic import service", async () => {
    const importRateList = vi.fn().mockResolvedValue({ version: { status: "ACTIVE" }, items: [] });
    const service = new DefaultRateListService({ importRateList } as any);
    const catalog = page(1, 132);
    await service.importRateList({ ...catalog, organization_id: scope.organizationId, idempotency_key: "approved" });
    expect(importRateList).toHaveBeenCalledWith(expect.objectContaining({ standardDiscountPercent: 50, items: catalog.items }));
    await service.importRateList({ ...catalog, complete: false, organization_id: scope.organizationId, idempotency_key: "partial-approved" });
    expect(importRateList).toHaveBeenCalledTimes(2);
    expect(importRateList.mock.calls[1]?.[0]).toMatchObject({complete:false,items:catalog.items});
  });
});

describe("conservative catalog row recovery",()=>{
  it("skips blank/dashed/missing/ambiguous prices, preserving exact positive prices and explicit zero",()=>{
    const valid=page(1,1);const row=valid.items[0]!;
    const result=normalizeCatalogPage({...valid,items:[row,...[null,"","-","—","1/2","2x3",undefined].map(list_price=>({...row,list_price})),{...row,list_price:"۱٬۲۳۴٫۵"},{...row,list_price:0},{...row,list_price:5,unit:null}]});
    expect(result.items.map(row=>row.list_price)).toEqual([1527,1234.5,0]);
    expect(result.warnings.join(" ")).toContain("Skipped 7");expect(result.warnings.join(" ")).toContain("Skipped 1");
  });
  it.each(["half a price","half a name","missing row brace","trailing comma","missing array/root braces"])("drops an unfinished tail: %s",kind=>{
    const metadata={documentType:"rate_list",name:"Dura Max U-PVC",standardDiscountPercent:null,complete:true,confidence:.99,warnings:[]};
    const row={...page(1,1).items[0]!,name:'Socket, {heavy} "quoted" \\ fitting'};
    const tails:Record<string,string>={"half a price":',{"brand":"Dura","list_price":12',"half a name":',{"name":"unfinished',"missing row brace":','+JSON.stringify({...row,list_price:3}).slice(0,-1),"trailing comma":',',"missing array/root braces":""};
    const text=JSON.stringify(metadata).slice(0,-1)+',"items":['+JSON.stringify(row)+tails[kind];
    const result=recoverCatalogPage(text);expect(result.items).toEqual([row]);expect(result.complete).toBe(false);expect(result.warnings.join(" ")).toContain("complete item records");
  });
  it("never repairs a transaction, missing catalog heading, or non-JSON source text",()=>{
    for(const raw of ['{"documentType":"invoice","items":[{}', '{"items":[{"list_price":5}', 'not JSON'])expect(()=>recoverCatalogPage(raw)).toThrow();
    expect(()=>mergeCatalogPages([normalizeCatalogPage({...page(1,1),items:[{...page(1,1).items[0],list_price:"-"}]})])).toThrow("No unambiguous priced items");
  });
});

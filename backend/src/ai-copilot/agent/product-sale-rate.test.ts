import {describe,it,expect,vi} from "vitest";
import {fixture,scope,call} from "./stateful.test-fixtures.js";
import {ApiError} from "../../errors/api-error.js";

describe("single-call authoritative sale rates",()=>{
  it("resolves and prices without model-supplied IDs, inventory or a second model turn",async()=>{
    const f=fixture();f.script(call("erp_get_product_sale_rate",{query:"Popular PN-20 25mm"}));
    const result=await f.core.run({message:"What is the rate of Popular PN-20 25mm?"},scope);
    expect(result).toMatchObject({status:"completed",requiresConfirmation:false,toolNames:["erp_get_product_sale_rate"]});
    expect(result.answer).toContain("PKR 477/MTR");expect(result.answer).not.toContain("999999");
    expect(f.services.pricing.resolvePrice).toHaveBeenCalledWith(expect.objectContaining({organization_id:scope.organizationId,product_id:26,price_type:"SALE"}));
    expect(f.respond).toHaveBeenCalledTimes(1);expect(f.erpWrite).not.toHaveBeenCalled();
  });
  it("preserves an explicit brand from the original request",async()=>{
    const f=fixture();await f.tools.execute("erp_get_product_sale_rate",{query:"Elbow 90° 2 inch",brand:"Popular"},scope,undefined,"Dura Max Elbow 90° 2 inch rate?");
    expect(f.services.search.searchProducts).toHaveBeenCalledWith("Elbow 90° 2 inch",10,scope,"Dura Max");
  });
  it("retains the original Urdu angle and size when the model shortens its query",async()=>{
    const f=fixture();await f.tools.execute("erp_get_product_sale_rate",{query:"Elbow"},scope,undefined,"ڈیورا میکس یو پی وی سی ایلبو 90 ڈگری 2 انچ کا ریٹ بتاؤ");
    expect(f.services.search.searchProducts).toHaveBeenCalledWith("ڈیورا میکس یو پی وی سی ایلبو 90 ڈگری 2 انچ",10,scope,"Dura Max");
  });
  it.each([
    ["What is the rate of Dura Max PPRC Pipe PN-16 25mm?","Dura Max PPRC Pipe PN-16 25mm"],
    ["ڈیورا میکس یو پی وی سی ایلبو 90 ڈگری 2 انچ کا ریٹ بتاؤ","ڈیورا میکس یو پی وی سی ایلبو 90 ڈگری 2 انچ"],
  ])("completes a native legacy product-search call with all original specs: %s",async(message,expected)=>{
    const f=fixture();f.script(call("search_products",{query:"pipe"}));
    const result=await f.core.run({message},scope);
    expect(result.status).toBe("completed");expect(result.answer).toContain("PKR 477/MTR");
    expect(f.services.search.searchProducts).toHaveBeenCalledWith(expected,10,scope,"Dura Max");
    expect(f.respond).toHaveBeenCalledTimes(1);expect(f.erpWrite).not.toHaveBeenCalled();
  });
  it("never prices an ambiguous product or accepts guessed IDs",async()=>{
    const f=fixture();vi.mocked(f.services.search.searchProducts).mockResolvedValue({resolution:"ambiguous",requiresClarification:true,bestCandidate:null,items:[],hasMore:false});
    const result=await f.tools.execute("erp_get_product_sale_rate",{query:"pipe"},scope);
    expect(result).toMatchObject({resolution:"ambiguous"});expect(f.services.pricing.resolvePrice).not.toHaveBeenCalled();
    await expect(f.tools.execute("erp_get_product_sale_rate",{query:"pipe",rate_list_id:999},scope)).rejects.toMatchObject({code:"INVALID_COPILOT_TOOL_INPUT"});
  });
  it("requires permission and verifies the rate's source product",async()=>{
    const f=fixture();vi.mocked(f.services.tenant.assertPermission).mockRejectedValueOnce(new ApiError(403,"FORBIDDEN","Denied"));
    await expect(f.tools.execute("erp_get_product_sale_rate",{query:"pipe"},scope)).rejects.toMatchObject({status:403});
    expect(f.services.search.searchProducts).not.toHaveBeenCalled();
    vi.mocked(f.services.pricing.resolvePrice).mockResolvedValue({...await fixture().services.pricing.resolvePrice({} as any),product_id:999} as any);
    await expect(f.tools.execute("erp_get_product_sale_rate",{query:"pipe"},scope)).rejects.toMatchObject({code:"RATE_SOURCE_INVALID"});
  });
});

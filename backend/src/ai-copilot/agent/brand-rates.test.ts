import {describe,it,expect,vi} from "vitest";
import {fixture,scope,call} from "./stateful.test-fixtures.js";
import {resolveCandidates} from "../../services/entity-search.service.js";
import {ApiError} from "../../errors/api-error.js";
function setup(){
  const f=fixture();
  vi.mocked(f.services.search.searchProducts).mockImplementation(async(_q,limit,_scope,brand)=>resolveCandidates([{id:brand==="Dura Max"?1:brand==="Popular"?2:3,name:brand+" PPR-C Elbow 25mm",sku:"E25",category:"Fittings",brandName:brand??null,unit:"pcs",confidence:.99,match_kind:"exact_name"}],limit));
  vi.mocked(f.services.pricing.resolvePrice).mockImplementation(async input=>({product_id:input.product_id,rate_list_id:4,rate_list_version_id:10,rate_list_item_id:input.product_id,unit_price:54,unit:"pcs",currency_code:"PKR",minimum_quantity:1,scope_type:"GLOBAL",effective_from:"2026-01-01T00:00:00Z"}));
  return f;
}
describe("shop brand rate comparisons",()=>{
  it("prices an unbranded Urdu question across three hard brand filters in one model turn",async()=>{
    const f=setup();f.script(call("erp_get_product_sale_rate",{query:"Elbow"}));
    const result=await f.core.run({message:"ایلبو 25 کا ریٹ بتاؤ"},scope);
    expect(result.status).toBe("completed");expect(f.respond).toHaveBeenCalledOnce();
    expect(result.reports?.[0]).toMatchObject({kind:"brand_rates",rows:[{brand:"Dura Max",listPrice:54,discountPercent:50,netPrice:27},{brand:"Popular",discountPercent:41,netPrice:31.86},{brand:"Turk Plast",discountPercent:45,netPrice:29.7}]});
    expect(result.answer).toContain("حتمی ریٹ PKR");expect(f.erpWrite).not.toHaveBeenCalled();
  });
  it("keeps an explicit single brand and flat discount from the original Urdu instruction",async()=>{
    const f=setup();const result=await f.tools.execute("erp_get_product_sale_rate",{query:"Elbow 32mm",brand:"Popular"},scope,undefined,"ڈیورامیکس ایلبو 25mm 50 فیصد پر کا ریٹ بتاؤ") as any;
    expect(f.services.search.searchProducts).toHaveBeenCalledTimes(1);expect(f.services.search.searchProducts).toHaveBeenCalledWith(expect.stringContaining("25mm"),5,scope,"Dura Max");
    expect(result.report.rows).toMatchObject([{brand:"Dura Max",listPrice:54,discountPercent:50,netPrice:27}]);
  });
  it("leaves missing brands unavailable instead of using a competing product",async()=>{
    const f=setup();vi.mocked(f.services.search.searchProducts).mockResolvedValueOnce(resolveCandidates([],5));
    const result=await f.tools.execute("erp_compare_brand_rates",{query:"Elbow 25mm"},scope) as any;
    expect(result.report.rows[0]).toMatchObject({brand:"Dura Max",listPrice:null,netPrice:null});expect(f.services.pricing.resolvePrice).toHaveBeenCalledTimes(2);
  });
  it("displays a read-only discounted quote without a purchase-cost verification deadlock",async()=>{
    const f=setup();f.services.memory={assertFloor:vi.fn(async()=>{throw new ApiError(422,"DISCOUNT_BELOW_COST","cost");})} as any;
    const result=await f.tools.execute("erp_compare_brand_rates",{query:"Elbow 25mm",brands:["Dura Max"]},scope) as any;
    expect(result.report.rows[0]).toMatchObject({listPrice:54,discountPercent:50,netPrice:27});
  });
  it("checks sales permission before reading comparison catalogs",async()=>{
    const f=setup();vi.mocked(f.services.tenant.assertPermission).mockRejectedValue(new ApiError(403,"FORBIDDEN","denied"));
    await expect(f.tools.execute("erp_compare_brand_rates",{query:"Elbow 25mm"},scope)).rejects.toMatchObject({status:403});expect(f.services.search.searchProducts).not.toHaveBeenCalled();
  });
});

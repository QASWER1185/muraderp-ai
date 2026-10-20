import { expect, it, vi } from "vitest";
import { ErpToolRegistry } from "../agent/erp-tools.js";
import { CONVERSATIONAL_INSTRUCTIONS } from "../agent/model.js";
import { ApiError } from "../../errors/api-error.js";

it("advertises the authorized import tool, prepares every row, and enforces products.write",async()=>{
  const scope={userId:"actor",organizationId:"organization",branchId:"branch"};
  const createUnifiedDraft=vi.fn(async()=>({draftId:"saved-preview",idempotencyKey:"import-key",requiresConfirmation:true}));
  const tenant={assertPermission:vi.fn(async()=>{}),assertBranchAccess:vi.fn(async()=>{})};
  const tools=new ErpToolRegistry({tenant,runtime:{createUnifiedDraft}} as any);
  const tool=tools.definitions().find(tool=>tool.name==="erp_import_rate_list");
  expect(tool?.parameters).toMatchObject({type:"object",required:expect.arrayContaining(["brand","category","effectiveDate","items"])});
  expect(CONVERSATIONAL_INSTRUCTIONS).toContain("You ARE fully authorized to import and update product rate lists using the erp_import_rate_list tool");
  const input={brand:"Dura Max",category:"Electric Conduit Pipes & Fittings",effectiveDate:"2026-10-20",
    items:Array.from({length:35},(_,i)=>({name:"Conduit Elbow",size:(16+i)+"mm",unit:"pcs",list_price:100+i,discount:0}))};
  expect(await tools.execute("erp_import_rate_list",input,scope)).toMatchObject({review:{draftId:"saved-preview",requiresConfirmation:true}});
  expect(createUnifiedDraft).toHaveBeenCalledWith("erp_import_rate_list",input,scope,"text");
  expect(tenant.assertPermission).toHaveBeenCalledWith(scope,"products.write");
  tenant.assertPermission.mockRejectedValueOnce(new ApiError(403,"FORBIDDEN","Permission denied"));
  await expect(tools.execute("erp_import_rate_list",input,scope)).rejects.toMatchObject({status:403});
  expect(createUnifiedDraft).toHaveBeenCalledOnce();
});

import { expect, it, vi } from "vitest";
import { CopilotRuntime, type CopilotRuntimeDependencies } from "./copilot.runtime.js";

function fixture(source="image") {
  const scope={organizationId:"a3000000-0000-4000-8000-000000000002",branchId:"a3000000-0000-4000-8000-000000000003",userId:"a3000000-0000-4000-8000-000000000001"};
  const action:any={id:"action",organization_id:scope.organizationId,user_id:scope.userId,idempotency_key:"key",status:"CONFIRMED",result:{id:31},
    action_plan:{...scope,source,target:"estimate",requiresConfirmation:true,lines:[],unifiedAction:{tool:"erp_create_estimate",input:{items:[{rawShorthand:"dm med 3/4",size:"3/4 inch"}]},
      data:{lines:[{product_id:11,productName:"Dura Max Medium Pipe",unit:"pcs"}]},preview:{title:"estimate",summary:"review"}}}};
  const db={from:()=>{const q:any={};for(const name of ["select","eq"])q[name]=()=>q;q.update=(data:any)=>{Object.assign(action,data);return q;};q.maybeSingle=q.single=async()=>({data:action,error:null});q.then=(resolve:any)=>q.single().then(resolve);return q;}};
  const operations={prepare:vi.fn(),execute:vi.fn(),verify:vi.fn(),report:vi.fn()};
  const slipLearning={examples:vi.fn(),confirm:vi.fn(async()=>{})};
  const deps={database:()=>db,authorization:{assertPermission:vi.fn()},branchAccess:{assertBranchAccess:vi.fn()},references:{assertOwnedReferences:vi.fn()},
    operations,slipLearning,erp:{getProduct:vi.fn(async()=>({id:11,name:"Dura Max Medium Pipe",unit:"pcs"}))}} as unknown as CopilotRuntimeDependencies;
  const runtime=new CopilotRuntime(deps.erp,deps);
  return {action,operations,slipLearning,scope,run:()=>runtime.confirmAndExecute("action",scope.organizationId,scope.userId,"key",scope.branchId)};
}

it("teaches only after independent ERP verification and before finalizing the action",async()=>{
  const f=fixture();await f.run();
  expect(f.operations.verify.mock.invocationCallOrder[0]).toBeLessThan(f.slipLearning.confirm.mock.invocationCallOrder[0]!);
  expect(f.slipLearning.confirm).toHaveBeenCalledWith(f.scope,"action",[{raw_shorthand:"dm med 3/4",verified_item_name:"Dura Max Medium Pipe",verified_size:"3/4 inch",verified_unit:"pcs"}]);
  expect(f.action.status).toBe("EXECUTED");expect(f.operations.execute).not.toHaveBeenCalled();
});
it("never teaches a slip whose independent ERP verification failed",async()=>{
  const f=fixture();f.operations.verify.mockRejectedValueOnce(new Error("saved lines mismatch"));
  await expect(f.run()).rejects.toMatchObject({code:"COPILOT_VERIFICATION_FAILED"});
  expect(f.slipLearning.confirm).not.toHaveBeenCalled();expect(f.action.status).toBe("CONFIRMED");
});
it("retries failed learning from the saved result without executing the sale again",async()=>{
  const f=fixture();f.slipLearning.confirm.mockRejectedValueOnce(new Error("learning unavailable"));
  await expect(f.run()).rejects.toMatchObject({code:"COPILOT_VERIFICATION_FAILED"});expect(f.action.status).toBe("CONFIRMED");
  await f.run();expect(f.action.status).toBe("EXECUTED");expect(f.operations.execute).not.toHaveBeenCalled();
});
it("does not teach ordinary text transactions",async()=>{
  const f=fixture("text");await f.run();expect(f.slipLearning.confirm).not.toHaveBeenCalled();
});

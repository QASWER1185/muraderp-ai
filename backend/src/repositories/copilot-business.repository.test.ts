import { describe,expect,it,vi } from "vitest";
import { SupabaseCopilotBusinessRepository } from "./copilot-business.repository.js";
import { SupabaseCustomerPaymentBrowserRepository } from "./customer-payment-browser.repository.js";
import { SupabaseVendorPaymentBrowserRepository } from "./vendor-payment-browser.repository.js";
import { scope,ledger } from "../ai-copilot/agent/business.test-fixtures.js";
describe("Part 3 business read repository contracts",()=>{
  it("passes the complete actor/organization/branch scope and paging to the authoritative RPC",async()=>{
    const rpc=vi.fn(async()=>({data:ledger,error:null}));const repository=new SupabaseCopilotBusinessRepository(()=>({rpc}));
    expect(await repository.customerLedger(scope,19,1,10)).toEqual(ledger);
    expect(rpc).toHaveBeenCalledWith("copilot_customer_ledger",{p_user_id:scope.userId,p_organization_id:scope.organizationId,p_branch_id:scope.branchId,p_customer_id:19,p_limit:1,p_before_id:10});
  });
  it.each(["42501","PGRST202"])("does not turn RPC error %s into a zero or empty balance",async code=>{
    const repository=new SupabaseCopilotBusinessRepository(()=>({rpc:vi.fn(async()=>({data:null,error:{code}}))}));
    await expect(repository.customerLedger(scope,19,10)).rejects.toMatchObject({status:code==="42501"?403:502});
  });
  it("rejects malformed authoritative results instead of coercing null balance to zero",async()=>{
    const repository=new SupabaseCopilotBusinessRepository(()=>({rpc:vi.fn(async()=>({data:{...ledger,balances:[{currency_code:"PKR",debit:null,credit:0,outstanding:null}]},error:null}))}));
    await expect(repository.customerLedger(scope,19,10)).rejects.toBeDefined();
  });
  it.each(["customer","vendor"])("filters %s allocation reads by party, branch, organization and selected document IDs",async kind=>{
    const filters:Array<[string,string,unknown]>=[];
    const from=(table:string)=>{const chain:any={select:()=>chain,eq:(field:string,value:unknown)=>{filters.push([table,field,value]);return chain;},in:(field:string,value:unknown)=>{filters.push([table,field,value]);return chain;},order:()=>chain,limit:()=>chain,lt:()=>chain,then:(resolve:(value:unknown)=>unknown)=>resolve({data:[],error:null})};return chain;};
    if(kind==="customer")await new SupabaseCustomerPaymentBrowserRepository(()=>({from}) as any).listReceivables(scope.organizationId,scope.branchId,20,undefined,{customerId:19,invoiceIds:[501]});
    else await new SupabaseVendorPaymentBrowserRepository(()=>({from}) as any).listPayables(scope.organizationId,scope.branchId,20,undefined,{vendorId:8,purchaseIds:[601]});
    const table=kind==="customer"?"invoices":"purchases";
    expect(filters).toContainEqual([table,"organization_id",scope.organizationId]);expect(filters).toContainEqual([table,"branch_id",scope.branchId]);
    expect(filters).toContainEqual([table,kind+"_id",kind==="customer"?19:8]);expect(filters).toContainEqual([table,"id",kind==="customer"?[501]:[601]]);
  });
});

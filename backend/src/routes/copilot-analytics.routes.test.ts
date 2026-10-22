import express from "express";
import request from "supertest";
import {describe,it,expect,vi} from "vitest";
import {createAiCopilotRouter} from "./ai-copilot.routes.js";
import {ErpToolRegistry} from "../ai-copilot/agent/erp-tools.js";
import {fixture,scope} from "../ai-copilot/agent/stateful.test-fixtures.js";
function setup(){
  const f=fixture(),read=vi.fn(async()=>({analytics:true as const,tool:"erp_get_inventory_summary" as const,period:{from:"2026-10-22",to:"2026-10-22"},metrics:{productCount:205,productsWithStock:0},rows:[],notes:[]}));
  const tools=new ErpToolRegistry({...f.services,analytics:{read}}),app=express();app.use(express.json());
  app.use("/api/copilot",createAiCopilotRouter("test-token",undefined,"test-principal",undefined,undefined,tools));
  app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status??422).json({error:{code:error.code??"INVALID_INPUT"}}));
  return {app,read};
}
describe("read-only analytics endpoints",()=>{
  it("executes a validated scoped read without an approval draft",async()=>{
    const f=setup();const response=await request(f.app).post("/api/copilot/analytics/erp_get_inventory_summary").set("Authorization","Bearer test-token").set("X-Branch-Id",scope.branchId).send({organizationId:scope.organizationId,userId:scope.userId,input:{}});
    expect(response.status).toBe(200);expect(response.body).toMatchObject({requiresConfirmation:false,data:{report:{metrics:{productCount:205}}}});expect(response.headers["cache-control"]).toBe("no-store");expect(f.read).toHaveBeenCalledWith("erp_get_inventory_summary",{},scope);
  });
  it("rejects unauthenticated callers and write tools at this read endpoint",async()=>{
    const f=setup();expect((await request(f.app).post("/api/copilot/analytics/erp_get_inventory_summary").send({})).status).toBe(401);
    expect((await request(f.app).post("/api/copilot/analytics/erp_create_customer").set("Authorization","Bearer test-token").send({})).status).toBe(404);expect(f.read).not.toHaveBeenCalled();
  });
});

import { createHmac, randomBytes } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
vi.mock("../config/env.js",async importOriginal=>{const original=await importOriginal<typeof import("../config/env.js")>();return {...original,env:{...original.env,INTERNAL_API_TOKEN:randomBytes(32).toString("hex")}};});
import { env } from "../config/env.js";
import { createAiCopilotRouter } from "./ai-copilot.routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import { CopilotAgent } from "../ai-copilot/copilot-agent.js";
import { writeBusinessState } from "../ai-copilot/agent/business-state.js";
import { businessFixture, scope, customerPayment, vendorPayment, call } from "../ai-copilot/agent/business.test-fixtures.js";

async function setup(kind="customer"){
  const f=businessFixture();
  await f.tools.execute(kind==="customer"?"prepare_customer_payment":"prepare_vendor_payment",kind==="customer"?customerPayment:vendorPayment,scope,f.state);
  const records=new Map<string,object>();
  const runtime={createFinancialDraft:vi.fn(async(_input:unknown,key:string)=>{
    if(!records.has(key))records.set(key,{id:"55555555-5555-4555-8555-555555555555",status:"DRAFT",idempotency_key:key});return records.get(key);
  }),confirmAndExecute:vi.fn(async()=>({status:"EXECUTED"}))};
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.log={info:vi.fn(),warn:vi.fn()} as any;next();});
  app.use("/copilot",createAiCopilotRouter(env.INTERNAL_API_TOKEN,runtime as any,"service",new CopilotAgent(f.core),f.core,f.tools));app.use(errorHandler);
  const cookieFor=(userId:string)=>{const payload=Buffer.from(JSON.stringify({userId,exp:Math.floor(Date.now()/1000)+60})).toString("base64url");return `muraderp_session=${payload}.${createHmac("sha256",env.INTERNAL_API_TOKEN!).update(payload).digest("base64url")}`;};
  return {...f,app,runtime,cookie:cookieFor(scope.userId),cookieFor,body:{conversationToken:writeBusinessState(f.state),conversationId:f.state.conversationId}};
}
const headers={"X-Organization-Id":scope.organizationId,"X-Branch-Id":scope.branchId};
describe("Part 3 browser-only payment approval integration",()=>{
  it.each(["customer","vendor"])("revalidates a signed %s review and persists only DRAFT before a separate confirmation",async kind=>{
    const f=await setup(kind);
    const send=()=>request(f.app).post("/copilot/conversation/payments").set(headers).set("Cookie",f.cookie).send(f.body);
    const first=await send();expect(first.status).toBe(201);expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body).toMatchObject({requiresConfirmation:true,executed:false,data:{status:"DRAFT"},paymentPreparation:{intent:kind+"_payment"}});
    expect(f.runtime.createFinancialDraft.mock.calls[0]?.[0]).toMatchObject({...scope,source:"text",intent:kind+"_payment",payment:kind==="customer"?customerPayment:vendorPayment});
    expect(f.runtime.confirmAndExecute).not.toHaveBeenCalled();expect(f.erpWrite).not.toHaveBeenCalled();
    const retry=await send();expect(retry.body.data).toEqual(first.body.data);
    expect(f.runtime.createFinancialDraft.mock.calls[1]?.[1]).toBe(f.runtime.createFinancialDraft.mock.calls[0]?.[1]);
    const confirmed=await request(f.app).post("/copilot/drafts/55555555-5555-4555-8555-555555555555/confirm").set(headers).set("Cookie",f.cookie).set("Idempotency-Key",first.body.data.idempotencyKey).send({});
    expect(confirmed.status).toBe(200);expect(f.runtime.confirmAndExecute).toHaveBeenCalledOnce();
  });
  it("returns signed receipt review through the unified agent route",async()=>{
    const f=await setup();f.script(call("lookup_customers",{query:"Qasim"}),call("prepare_customer_payment",customerPayment));
    const result=await request(f.app).post("/copilot/agent").set(headers).set("Cookie",f.cookie).send({message:"receive 200 cash Qasim invoice 501 date 2026-10-05"});
    expect(result.status).toBe(200);expect(result.body.data).toMatchObject({paymentPreparation:{payment:{amount:200}},requiresConfirmation:true});
    expect(f.runtime.createFinancialDraft).not.toHaveBeenCalled();expect(f.runtime.confirmAndExecute).not.toHaveBeenCalled();
  });
  it.each(["no browser","internal bearer","forged token","extra authority","wrong branch","wrong organization","wrong user","expired","wrong conversation"])("rejects %s before draft persistence",async mode=>{
    const f=await setup();const body={...f.body} as Record<string,unknown>;
    const req=request(f.app).post("/copilot/conversation/payments").set(headers);
    if(mode!=="no browser"&&mode!=="internal bearer")req.set("Cookie",mode==="wrong user"?f.cookieFor("44444444-4444-4444-8444-444444444444"):f.cookie);
    if(mode==="internal bearer")req.set("Authorization",`Bearer ${env.INTERNAL_API_TOKEN}`);
    if(mode==="forged token")body.conversationToken+="forged";
    if(mode==="extra authority")body.account_id="forged";
    if(mode==="wrong branch")req.set("X-Branch-Id","44444444-4444-4444-8444-444444444444");
    if(mode==="wrong organization")req.set("X-Organization-Id","44444444-4444-4444-8444-444444444444");
    if(mode==="wrong conversation")body.conversationId="44444444-4444-4444-8444-444444444444";
    if(mode==="expired"){f.state.expires=Date.now()-1;body.conversationToken=writeBusinessState(f.state);}
    expect((await req.send(body)).status).toBeGreaterThanOrEqual(400);expect(f.runtime.createFinancialDraft).not.toHaveBeenCalled();
  });
  it.each(["permission","branch","changed balance","missing invoice"])("rechecks %s on preparation after the signed review was issued",async mode=>{
    const f=await setup();
    if(mode==="permission")f.gateway.hasPermission.mockResolvedValue(false);
    if(mode==="branch")f.gateway.hasBranchAccess.mockResolvedValue(false);
    if(mode==="missing invoice")vi.mocked(f.business.customers.listReceivables).mockResolvedValue({data:[],next_cursor:null});
    if(mode==="changed balance")vi.mocked(f.business.customers.listReceivables).mockResolvedValue({data:[{invoice_id:501,customer_id:19,currency_code:"PKR",outstanding:100}] as any,next_cursor:null});
    const result=await request(f.app).post("/copilot/conversation/payments").set(headers).set("Cookie",f.cookie).send(f.body);
    expect(result.status).toBe(mode==="permission"||mode==="branch"?403:422);expect(f.runtime.createFinancialDraft).not.toHaveBeenCalled();
  });
  it("does not persist when no payment preparation exists",async()=>{
    const f=await setup();delete f.state.paymentPreparation;
    const result=await request(f.app).post("/copilot/conversation/payments").set(headers).set("Cookie",f.cookie).send({conversationToken:writeBusinessState(f.state),conversationId:f.state.conversationId});
    expect(result.status).toBe(422);expect(f.runtime.createFinancialDraft).not.toHaveBeenCalled();
  });
});

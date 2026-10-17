import { createHmac, randomBytes } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
vi.mock("../config/env.js",async importOriginal=>{const original=await importOriginal<typeof import("../config/env.js")>();return {...original,env:{...original.env,INTERNAL_API_TOKEN:randomBytes(32).toString("hex")}};});
import { env } from "../config/env.js";
import { createAiCopilotRouter } from "./ai-copilot.routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import { CopilotAgent } from "../ai-copilot/copilot-agent.js";
import { MultimodalAgentInput } from "../ai-copilot/agent/multimodal-input.js";
import { ProviderBusinessInput } from "../ai-input/business-input.provider.js";
import { businessFixture, scope, call, pipe, elbow, customer } from "../ai-copilot/agent/business.test-fixtures.js";
import { readBusinessState, writeBusinessState } from "../ai-copilot/agent/business-state.js";
import { resolveCandidates } from "../services/entity-search.service.js";
import { createCanvas } from "@napi-rs/canvas";

const headers={"X-Organization-Id":scope.organizationId,"X-Branch-Id":scope.branchId};
const document={customerName:"Qasim",vendorName:null,warehouseName:null,documentNumber:null,documentDate:null,currencyCode:"PKR",
  lines:[{productName:"EBOW FEMALE 25*1/2",productCode:null,brandHint:"Popular",quantity:20,unit:"PCS",unitRate:9999,discountPercent:10,confidence:.99}],
  discountPercent:10,subtotal:199980,total:179982,confidence:.99,warnings:[]};
const media=()=>({mimeType:"image/png",base64:createCanvas(120,60).toBuffer("image/png").toString("base64")});
function voice(){const b=Buffer.alloc(1644);b.write("RIFF");b.writeUInt32LE(b.length-8,4);b.write("WAVEfmt ",8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write("data",36);b.writeUInt32LE(1600,40);b.fill(12,44);return {mimeType:"audio/wav",base64:b.toString("base64")};}
function setup(){
  const f=businessFixture(),provider={generate:vi.fn(async()=>structuredClone(document)),transcribe:vi.fn(async()=>"Qasim Popular pipe 20 MTR 40% discount estimate")};
  const runtime={createConversationDraft:vi.fn(async(_state:unknown,_view:unknown)=>({id:"55555555-5555-4555-8555-555555555555",status:"DRAFT"})),confirmAndExecute:vi.fn(async()=>({status:"EXECUTED"}))};
  const app=express();app.use(express.json({limit:"12mb"}));app.use((req,_res,next)=>{req.log={info:vi.fn(),warn:vi.fn()} as any;next();});
  app.use("/copilot",createAiCopilotRouter(env.INTERNAL_API_TOKEN,runtime as any,"service",new CopilotAgent(f.core),f.core,f.tools,new MultimodalAgentInput(new ProviderBusinessInput(provider))));app.use(errorHandler);
  const cookieFor=(userId:string)=>{const payload=Buffer.from(JSON.stringify({userId,exp:Math.floor(Date.now()/1000)+60})).toString("base64url");return `muraderp_session=${payload}.${createHmac("sha256",env.INTERNAL_API_TOKEN!).update(payload).digest("base64url")}`;};
  const post=(path:string,body:object)=>request(app).post("/copilot/"+path).set(headers).set("Cookie",cookieFor(scope.userId)).send(body);
  return {...f,app,provider,runtime,cookieFor,post};
}
describe("Part 4 authenticated multimodal → unified ERP Agent integration",()=>{
  it.each(["image","camera","voice"])("creates a priced conversational draft from %s and requires separate preparation/confirmation",async source=>{
    const f=setup(),product=source==="voice"?pipe:elbow,discount=source==="voice"?40:10;
    if(source!=="voice")vi.mocked(f.services.search.searchProducts).mockResolvedValue(resolveCandidates([{...elbow,category:"Fitting",brandName:"Popular",confidence:.99,match_kind:"fuzzy_name"}],10));
    f.script(call("lookup_customers",{query:"Qasim"}),call("search_products",{query:source==="voice"?"Popular pipe":"EBOW FEMALE 25*1/2"}),call("begin_estimate_draft"),call("add_draft_item",{product_id:product.id,quantity:20,unit:product.unit}),call("update_draft_discount",{percent:discount}),call("prepare_estimate"));
    const first=await f.post("agent/input",{source,media:source==="voice"?voice():media()});
    expect(first.status).toBe(200);expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body.data).toMatchObject({draft:{prepared:true,totals:{grand_total:source==="voice"?6000:3600}},requiresConfirmation:true});
    expect(f.services.search.searchProducts).toHaveBeenCalledWith(source==="voice"?"Popular pipe":"EBOW FEMALE 25*1/2",10,scope);
    expect(f.services.catalog.getCatalog).not.toHaveBeenCalled();expect(f.erpWrite).not.toHaveBeenCalled();expect(f.runtime.createConversationDraft).not.toHaveBeenCalled();expect(f.runtime.confirmAndExecute).not.toHaveBeenCalled();
    const token=first.body.data.conversationToken,id=first.body.data.conversationId,state=readBusinessState(token,scope,id);
    expect(state.inputSource).toBe(source);expect(token).not.toContain(media().base64);
    const prepared=await f.post("conversation/drafts",{conversationToken:token,conversationId:id});expect(prepared.status).toBe(201);
    expect(f.runtime.createConversationDraft.mock.calls[0]?.[0]).toMatchObject({inputSource:source,customer:{id:customer.id}});
    expect(f.runtime.confirmAndExecute).not.toHaveBeenCalled();
    await request(f.app).post("/copilot/drafts/55555555-5555-4555-8555-555555555555/confirm").set(headers).set("Cookie",f.cookieFor(scope.userId)).set("Idempotency-Key","server-review").send({});
    expect(f.runtime.confirmAndExecute).toHaveBeenCalledOnce();
  });
  it("pauses weak OCR before model/tool calls and preserves conversation choices while invalidating approval",async()=>{
    const f=setup();f.state.draft={id:"55555555-5555-4555-8555-555555555555",revision:1,preparedRevision:1,lines:[]};f.provider.generate.mockResolvedValue({...document,confidence:.2});
    const result=await f.post("agent/input",{source:"image",media:media(),conversationToken:writeBusinessState(f.state),conversationId:f.state.conversationId});
    expect(result.status).toBe(200);expect(result.body.data).toMatchObject({status:"clarification",toolNames:[],requiresConfirmation:false,conversationId:f.state.conversationId,reviewText:expect.stringContaining("EBOW")});
    const state=readBusinessState(result.body.data.conversationToken,scope,result.body.data.conversationId);
    expect(state.customer).toEqual(f.state.customer);expect(state.draft?.preparedRevision).toBeUndefined();expect(f.respond).not.toHaveBeenCalled();expect(f.runtime.createConversationDraft).not.toHaveBeenCalled();
  });
  it("preserves an existing text draft when voice modifies its discount",async()=>{
    const f=setup();await f.tools.execute("begin_estimate_draft",{},scope,f.state);await f.tools.execute("add_draft_item",{quantity:20,unit:"MTR"},scope,f.state);
    f.provider.transcribe.mockResolvedValue("اس میں چالیس فیصد ڈسکاؤنٹ کر دو");f.script(call("update_draft_discount",{percent:40}));
    const result=await f.post("agent/input",{source:"voice",media:voice(),conversationToken:writeBusinessState(f.state),conversationId:f.state.conversationId});
    expect(result.status).toBe(200);expect(result.body.data.conversationId).toBe(f.state.conversationId);expect(result.body.data.draft.totals.grand_total).toBe(6000);expect(result.body.data.draft.lines).toHaveLength(1);
  });
  it.each(["no browser","internal bearer","wrong user","wrong org","wrong branch","forged token","expired","wrong conversation","extra authority"])("rejects %s before extraction/model calls",async reason=>{
    const f=setup();const body:Record<string,unknown>={source:"image",media:media(),conversationToken:writeBusinessState(f.state),conversationId:f.state.conversationId};
    const req=request(f.app).post("/copilot/agent/input").set(headers);
    if(!["no browser","internal bearer"].includes(reason))req.set("Cookie",f.cookieFor(reason==="wrong user"?"44444444-4444-4444-8444-444444444444":scope.userId));
    if(reason==="internal bearer")req.set("Authorization",`Bearer ${env.INTERNAL_API_TOKEN}`);
    if(reason==="wrong org")req.set("X-Organization-Id","44444444-4444-4444-8444-444444444444");if(reason==="wrong branch")req.set("X-Branch-Id","44444444-4444-4444-8444-444444444444");
    if(reason==="forged token")body.conversationToken+="bad";if(reason==="expired"){f.state.expires=Date.now()-1;body.conversationToken=writeBusinessState(f.state);}if(reason==="wrong conversation")body.conversationId="44444444-4444-4444-8444-444444444444";if(reason==="extra authority")body.userId=scope.userId;
    expect((await req.send(body)).status).toBeGreaterThanOrEqual(400);expect(f.provider.generate).not.toHaveBeenCalled();expect(f.respond).not.toHaveBeenCalled();
  });
  it("does not fabricate a missing rate or prepare a draft",async()=>{
    const f=setup();vi.mocked(f.services.pricing.resolvePrice).mockRejectedValue(new Error("missing rate"));
    f.script(call("lookup_customers",{query:"Qasim"}),call("search_products",{query:"elbow"}),call("begin_estimate_draft"),call("add_draft_item",{quantity:20,unit:"PCS"}),call("prepare_estimate"));
    const result=await f.post("agent/input",{source:"image",media:media()});expect(result.status).toBe(200);expect(result.body.data.draft).toMatchObject({totals:null,prepared:false});expect(f.runtime.createConversationDraft).not.toHaveBeenCalled();
  });
});
describe("Part 4 signed interactive ambiguity",()=>{
  it.each(["product","customer"])("offers structured candidates from a direct %s business query and resumes after selection",async kind=>{
    const f=setup();
    if(kind==="product")vi.mocked(f.services.search.searchProducts).mockResolvedValue(resolveCandidates([pipe,elbow].map(row=>({...row,category:"Fitting",brandName:"Popular",confidence:.75,match_kind:"partial_name"})),5));
    else vi.mocked(f.services.search.searchCustomers).mockResolvedValue(resolveCandidates([{...customer,city:"Lahore",confidence:.75,match_kind:"partial_name"},{...customer,id:20,city:"Karachi",confidence:.75,match_kind:"partial_name"}],5));
    const tool=kind==="product"?"query_inventory":"query_customer_ledger";
    f.script(call(tool,{query:kind==="product"?"Popular":"Qasim"}));
    const first=await f.post("agent",{message:kind==="product"?"Popular stock":"Qasim ledger"});
    expect(first.body.data.status).toBe("clarification");expect(first.body.data.clarification.kind).toBe(kind);
    f.script(call(tool,{}));
    const second=await f.post("agent",{message:"Continue",selection:{kind,id:kind==="product"?pipe.id:customer.id},conversationToken:first.body.data.conversationToken,conversationId:first.body.data.conversationId});
    expect(second.status).toBe(200);expect(second.body.data.status).toBe("completed");expect(second.body.data.businessFacts[0].kind).toBe(kind==="product"?"inventory":"customer_ledger");expect(f.erpWrite).not.toHaveBeenCalled();
  });
  it("selects a signed vendor and clears obsolete vendor choices after refinement",async()=>{
    const f=setup();vi.mocked(f.business.repository.searchVendors).mockResolvedValueOnce(resolveCandidates([{id:8,name:"Popular supplier",confidence:.75,match_kind:"partial_name"},{id:9,name:"Popular second",confidence:.75,match_kind:"partial_name"}],5));
    f.script(call("lookup_vendors",{query:"Popular"}));const first=await f.post("agent",{message:"Popular vendor documents"});
    expect(first.body.data.clarification.kind).toBe("vendor");f.script(call("list_payment_documents",{party_type:"vendor"}));
    const second=await f.post("agent",{message:"Continue",selection:{kind:"vendor",id:8},conversationToken:first.body.data.conversationToken,conversationId:first.body.data.conversationId});
    expect(second.status).toBe(200);expect(second.body.data.businessFacts[0].kind).toBe("payment_documents");
    f.state.clarification={kind:"vendor",candidates:[{id:8,name:"old supplier"}]};f.state.productUnresolved=true;
    await f.tools.execute("lookup_vendors",{query:"Popular supplier"},scope,f.state);expect(f.state.clarification).toBeUndefined();
  });
  it("continues the pending request after selecting an exact offered product",async()=>{
    const f=setup();vi.mocked(f.services.search.searchProducts).mockResolvedValue(resolveCandidates([pipe,elbow].map(row=>({...row,category:"Fitting",brandName:"Popular",confidence:.75,match_kind:"partial_name"})),5));
    f.script(call("search_products",{query:"Popular"}));const first=await f.post("agent",{message:"Prepare 20 PCS of Popular female elbow for Qasim"});
    expect(first.body.data.clarification).toMatchObject({kind:"product",candidates:[{id:pipe.id},{id:elbow.id}]});
    f.script(call("begin_estimate_draft"),call("add_draft_item",{quantity:20,unit:"PCS"}));
    const second=await f.post("agent",{message:"Continue",selection:{kind:"product",id:elbow.id},conversationToken:first.body.data.conversationToken,conversationId:first.body.data.conversationId});
    expect(second.status).toBe(200);expect(second.body.data.conversationId).toBe(first.body.data.conversationId);expect(second.body.data.draft.lines[0].productId).toBe(elbow.id);
    expect(JSON.stringify(f.respond.mock.calls)).toContain("Continue this pending untrusted request");expect(f.erpWrite).not.toHaveBeenCalled();
  });
  it.each(["unoffered","wrong kind","permission","removed","wrong scope"])("rejects %s selection before model execution",async reason=>{
    const f=setup();f.state.clarification={kind:"product",candidates:[{id:pipe.id,name:pipe.name}]};
    if(reason==="permission")f.gateway.hasPermission.mockResolvedValue(false);if(reason==="removed")vi.mocked(f.services.erp.getProduct).mockResolvedValue(null);
    const req=request(f.app).post("/copilot/agent").set(headers).set("Cookie",f.cookieFor(scope.userId));if(reason==="wrong scope")req.set("X-Branch-Id","44444444-4444-4444-8444-444444444444");
    const result=await req.send({message:"Continue",conversationToken:writeBusinessState(f.state),conversationId:f.state.conversationId,selection:{kind:reason==="wrong kind"?"customer":"product",id:reason==="unoffered"?999:pipe.id}});
    expect(result.status).toBeGreaterThanOrEqual(400);expect(f.respond).not.toHaveBeenCalled();
  });
  it("removes obsolete candidates when a subsequent search fails",async()=>{
    const f=setup();f.state.clarification={kind:"product",candidates:[{id:pipe.id,name:pipe.name}]};f.state.productUnresolved=true;
    vi.mocked(f.services.search.searchProducts).mockRejectedValue(new Error("unavailable"));f.script(call("search_products",{query:"other"}));
    const result=await f.post("agent",{message:"find other product",conversationToken:writeBusinessState(f.state),conversationId:f.state.conversationId});
    expect(result.body.data.clarification).toBeUndefined();expect(readBusinessState(result.body.data.conversationToken,scope,result.body.data.conversationId).productContext).toBeUndefined();
  });
});

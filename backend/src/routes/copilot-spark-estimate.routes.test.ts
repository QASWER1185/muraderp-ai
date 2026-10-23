import { createHmac } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
vi.mock("../config/env.js",async original=>{
  const module=await original<typeof import("../config/env.js")>();
  return {...module,env:{...module.env,INTERNAL_API_TOKEN:"synthetic-test-session-signing-secret"}};
});
import { env } from "../config/env.js";
import { GeminiAdapter } from "../ai/providers/gemini.adapter.js";
import { ProviderBusinessInput } from "../ai-input/business-input.provider.js";
import { MultimodalAgentInput } from "../ai-copilot/agent/multimodal-input.js";
import { DefaultErpOperations } from "../ai-copilot/tools/operations.js";
import { SupabaseEntitySearchService, resolveCandidates } from "../services/entity-search.service.js";
import { createAiCopilotRouter } from "./ai-copilot.routes.js";
import { errorHandler } from "../middleware/error-handler.js";

const scope={userId:"11111111-1111-4111-8111-111111111111",organizationId:"22222222-2222-4222-8222-222222222222",branchId:"33333333-3333-4333-8333-333333333333"};
const jpeg=createCanvas(64,32).toBuffer("image/jpeg").toString("base64");
const caption="Arslan Shahnawaz Sb, Ittehad Town, Dera Max 50% estimate";
function document(index=0){return {customerName:null,customerAddress:null,requestedBrand:null,vendorName:null,warehouseName:null,documentNumber:null,documentDate:null,currencyCode:"PKR",
  lines:[{raw_line:"PPR-C Elbow "+(index%2?"32mm":"25mm")+" 3pcs",item_name:"Elbow",material:"PPR-C",size:index%2?"32mm":"25mm",specification:null,quantity:3,unit:null}],
  observedLineCount:1,ignoredLineCount:0,discountPercent:20,subtotal:null,total:null,confidence:.7,warnings:["Printed rates are observations only."]};}
function setup(){
  let index=0;
  const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{functionCall:{name:"erp_proposal",args:{proposal:document(index++)}}}]}}]})));
  const provider=new GeminiAdapter({provider:"gemini",model:"test-gemini-model",speechModel:"test-model",apiKey:"synthetic-test-provider-key"},fetcher);
  const products=[{id:11,name:"Dura Max PPR-C Elbow 25mm",sku:"DM-25",unit:"pcs",brand_id:5,category:"Fittings"},
    {id:12,name:"Dura Max PPR-C Elbow 32mm",sku:"DM-32",unit:"pcs",brand_id:5,category:"Fittings"}];
  const rpc=vi.fn(async()=>({data:[{...products[0],id:99,name:"Popular PPR-C Elbow 25mm",brand_name:"Popular",confidence:1,match_kind:"exact_name"},
    ...products.slice().reverse().map(product=>({...product,brand_name:"Dura Max",confidence:.99,match_kind:"exact_name"}))],error:null}));
  const search=new SupabaseEntitySearchService(()=>({rpc}) as any);
  const noStock=vi.fn(async()=>{throw new Error("Quotation must never read stock");});
  const deps:any={principal:"test-api-service",database:()=>({rpc:vi.fn()}),
    erp:{getCustomer:vi.fn(async()=>null),getProduct:vi.fn(async(id:number)=>products.find(product=>product.id===id)),listInventory:noStock,listWarehouses:noStock},
    search:{searchCustomers:vi.fn(async()=>resolveCandidates([],5)),searchProducts:search.searchProducts.bind(search),getProductBrand:vi.fn(async()=>"Dura Max")},
    pricing:{resolvePrice:vi.fn(async(input:any)=>({product_id:input.product_id,unit_price:input.product_id===11?100:200,unit:"pcs",currency_code:"PKR",rate_list_id:4,rate_list_version_id:8}))},
    memory:{recall:vi.fn(),assertFloor:vi.fn(async()=>{}),latestSale:vi.fn()},estimates:{getEstimateAggregate:vi.fn()}};
  const operations=new DefaultErpOperations(deps);
  const execute=vi.fn(async(name:string,choices:unknown)=>{
    const action=await operations.prepare(name as "erp_create_estimate",choices,scope);
    return {review:{intent:"erp_action",tool:name,draftId:"55555555-5555-4555-8555-555555555555",idempotencyKey:"combined-preview",preview:action.preview}};
  });
  const tools={assertScope:vi.fn(async()=>{}),definitions:()=>[{name:"erp_create_estimate"}],execute};
  const agent={run:vi.fn(async()=>{throw new Error("No second model or customer-confirmation turn is needed");})};
  const app=express();app.use(express.json({limit:"12mb"}));app.use((req,_res,next)=>{req.log={warn:vi.fn(),error:vi.fn(),info:vi.fn()} as any;next();});
  app.use("/api/copilot",createAiCopilotRouter(env.INTERNAL_API_TOKEN,undefined,"test-api-service",undefined,agent as any,tools as any,new MultimodalAgentInput(new ProviderBusinessInput(provider))));app.use(errorHandler);
  const payload=Buffer.from(JSON.stringify({userId:scope.userId,exp:Math.floor(Date.now()/1000)+60})).toString("base64url");
  const cookie=`muraderp_session=${payload}.${createHmac("sha256",env.INTERNAL_API_TOKEN!).update(payload).digest("base64url")}`;
  const post=(body:object)=>request(app).post("/api/copilot/chat").set("Cookie",cookie).set("X-Organization-Id",scope.organizationId).set("X-Branch-Id",scope.branchId).send(body);
  return {post,fetcher,execute,deps,noStock,agent,rpc,operations};
}

describe("authenticated WhatsApp slip → one complete Urdu estimate preview",()=>{
  it("normalizes a JPEG data URL, attaches a new customer and prices only the exact Dura size without stock",async()=>{
    const f=setup();
    const response=await f.post({source:"image",task:"estimate",message:caption,fileName:"WhatsApp Image.jpeg",media:{mimeType:"IMAGE/JPG",base64:`data:image/jpg;base64,${jpeg}`}});
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({status:"review",requiresConfirmation:true,toolNames:["erp_create_estimate"],review:{preview:{lines:[{product_id:11,unit_price:100,discountPercent:50,quantity:3}],totals:{grand_total:150}}}});
    expect(response.body.data.answer).toContain("بطور نیا گاہک");
    expect(response.body.data.answer).toContain("Arslan Shahnawaz Sb");
    expect(f.execute.mock.calls[0]?.[1]).toMatchObject({customerName:"Arslan Shahnawaz Sb",customerAddress:"Ittehad Town",brand:"Dura Max",discountScheme:{percent:50}});
    expect(f.rpc).toHaveBeenCalledWith("search_catalog_products",expect.objectContaining({p_brand:"Dura Max",p_query:"PPR-C Elbow 25mm"}));
    const body=JSON.parse(String(f.fetcher.mock.calls[0]![1]!.body));
    expect(body.contents[0].parts[0].inlineData).toEqual({mimeType:"image/jpeg",data:jpeg});
    expect(f.noStock).not.toHaveBeenCalled();expect(f.agent.run).not.toHaveBeenCalled();
    expect(f.deps.memory.assertFloor).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body.data.review)).not.toContain("Popular");
  });
  it("consolidates ten simultaneous image attachments into one full preview",async()=>{
    const f=setup();
    const response=await f.post({source:"image",task:"estimate",message:caption,attachments:Array.from({length:10},(_,i)=>({fileName:`slip-${i}.jpeg`,media:{mimeType:"image/jpeg",base64:jpeg}}))});
    expect(response.status).toBe(200);expect(f.fetcher).toHaveBeenCalledTimes(10);expect(f.execute).toHaveBeenCalledOnce();
    expect(response.body.data.review.preview.lines).toHaveLength(10);
    expect(response.body.data.review.preview.totals.grand_total).toBe(2250);
    expect(response.body.data.extraction.document.observedLineCount).toBe(10);
    expect(f.noStock).not.toHaveBeenCalled();
  });
  it("rejects mismatched transport MIME locally before any Gemini request",async()=>{
    const f=setup();const response=await f.post({source:"image",message:caption,media:{mimeType:"image/png",base64:`data:image/jpeg;base64,${jpeg}`}});
    expect(response.status).toBe(400);expect(response.body.error.message).toMatch(/[\u0600-\u06ff]/u);expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("cannot price an explicit product ID at another size",async()=>{
    const f=setup();await expect(f.operations.prepare("erp_create_estimate",{customerName:"Arslan",brand:"Dura Max",items:[{productId:12,name:"PPR-C Elbow",size:"25mm",qty:1}]},scope)).rejects.toMatchObject({code:"ERP_ACTION_CLARIFICATION"});
    expect(f.deps.pricing.resolvePrice).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createAiProvider } from "./factory.js";
import { RateListCatalogPageSchema } from "../../ai-copilot/rate-list-catalog.js";
import { recoverCatalogPage } from "../../ai-copilot/catalog-extraction.js";
import { businessDocumentSchema } from "../../ai-input/business-input.provider.js";

const row = {brand:"Dura Max",category:"Pipes",name:"U-PVC Medium",size:"2 inch",unit:"length",list_price:2624};
const header = {documentType:"rate_list",name:"Dura Max U-PVC",standardDiscountPercent:null,complete:true,confidence:.99,warnings:[]};
const recovery = {recoverIncomplete:recoverCatalogPage,format:"json" as const};
const content = [{type:"input_image",image_url:"data:image/png;base64,YQ=="}];

function response(provider:string, raw:unknown, limited:boolean) {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  if(provider==="gemini")return {candidates:[{finishReason:limited?"MAX_TOKENS":"STOP",content:{parts:[{text}]}}]};
  if(provider==="anthropic")return {stop_reason:limited?"max_tokens":"tool_use",content:[{type:"tool_use",name:"erp_proposal",id:"observation",input:raw}]};
  if(provider==="groq")return {choices:[{finish_reason:limited?"length":"stop",message:{content:text}}]};
  return {status:limited?"incomplete":"completed",...(limited?{incomplete_details:{reason:"max_output_tokens"}}:{}),output:[{type:"message",content:[{type:"output_text",text}]}]};
}

describe.each(["gemini","openai","groq","anthropic"] as const)("%s catalog-only recovery",provider=>{
  const config={provider,apiKey:"catalog-test-key-1234567890",model:"model",visionModel:"vision",speechModel:"speech"};
  it("recovers only closed records when the output limit truncates a catalog",async()=>{
    const raw=JSON.stringify(header).slice(0,-1)+',"items":['+JSON.stringify(row)+',{"brand":"Dura Max","list_price":26';
    const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(response(provider,raw,true))));
    const result=await createAiProvider(config,fetcher).generate(RateListCatalogPageSchema,"extract",content,recovery) as any;
    expect(result.items).toEqual([row]);expect(result.complete).toBe(false);expect(result.warnings.join(" ")).toContain("complete item records");
    expect(fetcher).toHaveBeenCalledOnce();
    if(provider==="gemini"){
      const body=JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
      expect(body.generationConfig.responseMimeType).toBe("application/json");expect(body).not.toHaveProperty("tools");
    }
  });
  it("filters missing/dashed rates from a completed response without losing priced rows",async()=>{
    const raw={...header,items:[row,{...row,size:"3 inch",list_price:"-"},{...row,size:"4 inch",list_price:null}]};
    const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(response(provider,raw,false))));
    const result=await createAiProvider(config,fetcher).generate(RateListCatalogPageSchema,"extract",content,recovery) as any;
    expect(result.items).toEqual([row]);expect(result.warnings.join(" ")).toContain("Skipped 2");
  });
  it("keeps token-limit recovery disabled for transactional extraction",async()=>{
    const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(response(provider,'{"lines":[{"productName":"Pipe"',true))));
    await expect(createAiProvider(config,fetcher).generate(businessDocumentSchema,"extract",content)).rejects.toMatchObject({code:provider==="groq"?"AI_INVALID_OUTPUT":"AI_INCOMPLETE"});
    await expect(createAiProvider(config,fetcher).generate(businessDocumentSchema,"extract",content,recovery)).rejects.toMatchObject({code:"AI_INVALID_OUTPUT"});
  });
});

it("does not recover a Gemini safety refusal or a Responses content-filtered response",async()=>{
  for(const provider of ["gemini","openai"] as const){
    const body=provider==="gemini"?{candidates:[{finishReason:"SAFETY",content:{parts:[]}}]}:{status:"incomplete",incomplete_details:{reason:"content_filter"},output:[]};
    const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(body)));
    await expect(createAiProvider({provider,apiKey:"test-key",model:"model",speechModel:"speech"},fetcher).generate(RateListCatalogPageSchema,"extract",content,recovery)).rejects.toMatchObject({code:"AI_INCOMPLETE"});
  }
});

import { describe,expect,it,vi } from "vitest";
import { z } from "zod";
import { createAiProvider } from "./factory.js";
import { parseEnv } from "../../config/env.js";
import { UnifiedCopilotAgent } from "../../ai-copilot/agent/agent.js";
import { ProviderAgentModel } from "../../ai-copilot/agent/model.js";
import { fixture,scope,call } from "../../ai-copilot/agent/stateful.test-fixtures.js";
import { readBusinessState } from "../../ai-copilot/agent/business-state.js";
import { ApiError } from "../../errors/api-error.js";
import type { AiProviderName } from "./contracts.js";

const config=(provider:AiProviderName)=>({provider,model:"text-model",visionModel:"vision-model",speechModel:"speech-model",apiKey:"adapter-test-key",baseUrl:"https://compatible.example/v1"});
const native=(provider:string,parts:unknown[])=>provider==="gemini"?{candidates:[{finishReason:"STOP",content:{parts}}]}:{stop_reason:"end_turn",content:parts};
const text=(provider:string,value:string)=>provider==="gemini"?{text:value}:{type:"text",text:value};
const tool=(provider:string,name:string,args:unknown,id="native-call")=>provider==="gemini"?{functionCall:{name,args,id},thoughtSignature:"opaque-signature"}:{type:"tool_use",name,input:args,id};
const fetchResult=(body:unknown,status=200)=>vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}}));
const schema=z.strictObject({value:z.string()});

describe.each(["gemini","anthropic"] as const)("%s isolated native adapter",provider=>{
  it("maps tools, native IDs and reasoning signatures across turns without executing them",async()=>{
    const thinking=provider==="gemini"?{text:"reasoning",thought:true,thoughtSignature:"retained"}:{type:"thinking",thinking:"reasoning",signature:"retained"};
    const fetcher=fetchResult(native(provider,[thinking,tool(provider,"inspect_draft",{})]));
    const adapter=createAiProvider(config(provider),fetcher);const signal=new AbortController().signal;
    const first=await adapter.toolTurn("safe instructions",[{role:"user",content:"اب total بتاؤ"}],[{type:"function",name:"inspect_draft",description:"ERP read",parameters:{type:"object",properties:{},additionalProperties:false}}],{toolChoice:"required",signal});
    expect(first.output[1]).toMatchObject({type:"function_call",call_id:"native-call",name:"inspect_draft",arguments:"{}"});
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(native(provider,[text(provider,"done")]))));
    await adapter.toolTurn("safe instructions",[{role:"user",content:"اب total بتاؤ"},...first.output,{type:"function_call_output",call_id:"native-call",output:'{"total":477}'}],[],{signal});
    const [endpoint,options]=fetcher.mock.calls[1]!;const body=JSON.parse(String(options!.body));
    expect(endpoint).toContain(provider==="gemini"?"generativelanguage.googleapis.com":"api.anthropic.com");
    expect(options!.signal).toBe(signal);expect(options!.redirect).toBe("error");
    expect(JSON.stringify(body)).toContain("retained");
    expect(JSON.stringify(body)).toContain("native-call");
    expect(JSON.stringify(body)).toContain("477");
    expect(body).not.toHaveProperty("apiKey");
    const firstBody=JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    if(provider==="gemini")expect(firstBody.toolConfig.functionCallingConfig.mode).toBe("ANY");
    else expect(firstBody.tool_choice).toEqual({type:"any",disable_parallel_tool_use:true});
  });
  it("uses the configured text/vision models and validates structured output locally",async()=>{
    const result=provider==="gemini"?[text(provider,'{"value":"observed"}')]:[tool(provider,"erp_proposal",{value:"observed"})];
    const fetcher=fetchResult(native(provider,result));const adapter=createAiProvider(config(provider),fetcher);
    expect(await adapter.generate(schema,"extract",[{type:"input_text",text:"observation"}])).toEqual({value:"observed"});
    expect(await adapter.generate(schema,"extract",[{type:"input_image",image_url:"data:image/png;base64,YQ=="}])).toEqual({value:"observed"});
    const requestModels=fetcher.mock.calls.map(([url,options])=>provider==="gemini"?String(url):JSON.parse(String(options!.body)).model);
    expect(requestModels[0]).toContain("text-model");expect(requestModels[1]).toContain("vision-model");
    expect(JSON.stringify(fetcher.mock.calls[1]![1]!.body)).toContain("image/png");
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(native(provider,provider==="gemini"?[text(provider,'{"value":"x","inventedPrice":9999}')]:[tool(provider,"erp_proposal",{value:"x",inventedPrice:9999})]))));
    await expect(adapter.generate(schema,"extract",[{type:"input_text",text:"x"}])).rejects.toMatchObject({code:"AI_INVALID_OUTPUT"});
  });
  it("fails closed on refusal, incomplete generation, remote media and malformed tool calls",async()=>{
    const fetcher=fetchResult(provider==="gemini"?{candidates:[{finishReason:"SAFETY",content:{parts:[]}}]}:{stop_reason:"max_tokens",content:[]});
    const adapter=createAiProvider(config(provider),fetcher);
    await expect(adapter.toolTurn("safe",[{role:"user",content:"test"}],[])).rejects.toMatchObject({code:"AI_INCOMPLETE"});
    await expect(adapter.generate(schema,"safe",[{type:"input_image",image_url:"https://private.example/file"}])).rejects.toMatchObject({code:"AI_INPUT_UNSUPPORTED"});
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(native(provider,[tool(provider,"write",[])]))));
    await expect(adapter.toolTurn("safe",[{role:"user",content:"test"}],[])).rejects.toMatchObject({code:"AI_INVALID_OUTPUT"});
  });
  it("reports quota without retrying or leaking provider bodies or credentials",async()=>{
    const fetcher=fetchResult({error:{message:"SECRET upstream document"}},429);
    await expect(createAiProvider(config(provider),fetcher).toolTurn("safe",[{role:"user",content:"test"}],[])).rejects.toMatchObject({status:429,code:"AI_PROVIDER_RATE_LIMITED"});
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("requires a key and contains network/authentication/invalid JSON failures",async()=>{
    const fetcher=fetchResult({error:"secret"},401);const adapter=createAiProvider(config(provider),fetcher);
    await expect(createAiProvider({...config(provider),apiKey:undefined},fetcher).toolTurn("safe",[],[])).rejects.toMatchObject({code:"AI_NOT_CONFIGURED"});
    expect(fetcher).not.toHaveBeenCalled();
    await expect(adapter.toolTurn("safe",[],[])).rejects.toMatchObject({code:"AI_PROVIDER_ERROR"});
    fetcher.mockRejectedValueOnce(new Error("secret"));
    await expect(adapter.toolTurn("safe",[],[])).rejects.toMatchObject({code:"AI_PROVIDER_UNAVAILABLE"});
    fetcher.mockResolvedValueOnce(new Response("not JSON"));
    await expect(adapter.toolTurn("safe",[],[])).rejects.toMatchObject({code:"AI_INVALID_OUTPUT"});
  });
  it("runs the unchanged unified stateful tool loop with authoritative ERP pricing",async()=>{
    const steps=[["lookup_customers",{query:"Qasim"}],["set_task_context",{customer_id:19}],["begin_estimate_draft",{}],["search_products",{query:"Popular 25mm pipe"}],["add_draft_item",{quantity:20}],["inspect_draft",{}]] as const;
    let index=0;const fetcher=vi.fn<typeof fetch>(async()=>{
      const step=steps[index++];return new Response(JSON.stringify(native(provider,step?[tool(provider,step[0],step[1],"call-"+index)]:[text(provider,"Invented price 9999")])));});
    const f=fixture();const core=new UnifiedCopilotAgent(new ProviderAgentModel(createAiProvider(config(provider),fetcher)),f.tools);
    const first=await core.run({message:"Qasim Popular 20 meter estimate, observed price 9999"},scope);
    expect(first).toMatchObject({status:"completed",draft:{lines:[{quantity:20,rate:{unit_price:477}}],totals:{grand_total:9540}}});
    expect(first.answer).not.toContain("9999");
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(native(provider,[tool(provider,"update_draft_discount",{percent:10},"follow-up")]))));
    const next=await core.run({message:"اس پر 10 فیصد discount کرو",conversationToken:first.conversationToken,conversationId:first.conversationId},scope);
    expect(next).toMatchObject({status:"completed",draft:{id:first.draft!.id,totals:{grand_total:8586}}});
    expect(f.erpWrite).not.toHaveBeenCalled();expect(f.services.catalog.getCatalog).not.toHaveBeenCalled();
  });
});

describe("provider configuration and speech capabilities",()=>{
  it.each(["openai","groq","compatible","gemini","anthropic"] as const)("selects %s through configuration",provider=>{
    expect(createAiProvider(config(provider)).name).toBe(provider);
    expect(parseEnv({AI_PROVIDER:provider,AI_MODEL:"configured-model",...(provider==="compatible"?{AI_BASE_URL:"https://compatible.example/v1"}:{})}).success).toBe(true);
  });
  it.each(["gemini","anthropic","compatible"])("requires an explicit model for %s",provider=>{
    expect(parseEnv({AI_PROVIDER:provider,AI_BASE_URL:"https://compatible.example/v1"}).success).toBe(false);
  });
  it.each(["http://unsafe.example","https://user:password@example.com","https://example.com?token=secret","https://example.com#fragment"])("rejects insecure compatible endpoint %s",baseUrl=>{
    expect(()=>createAiProvider({...config("compatible"),baseUrl})).toThrow();
    expect(parseEnv({AI_PROVIDER:"compatible",AI_MODEL:"model",AI_BASE_URL:baseUrl}).success).toBe(false);
  });
  it("requires explicit Gemini or compatible speech models/endpoints",()=>{
    expect(parseEnv({AI_SPEECH_PROVIDER:"gemini"}).success).toBe(false);
    expect(parseEnv({AI_SPEECH_PROVIDER:"compatible",AI_SPEECH_MODEL:"model"}).success).toBe(false);
  });
  it("transcribes native Gemini audio in the original language and rejects silence",async()=>{
    const fetcher=fetchResult(native("gemini",[{text:'{"text":"قاسم کے لیے estimate بناؤ"}'}]));
    const adapter=createAiProvider(config("gemini"),fetcher);
    const media={mimeType:"audio/wav",base64:Buffer.from("RIFF1234WAVEdata").toString("base64")};
    expect(await adapter.transcribe(media)).toBe("قاسم کے لیے estimate بناؤ");
    expect(String(fetcher.mock.calls[0]![0])).toContain("speech-model");
    const body=JSON.parse(String(fetcher.mock.calls[0]![1]!.body));expect(body.contents[0].parts[0].inlineData.mimeType).toBe("audio/wav");
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(native("gemini",[{text:'{"text":null}'}]))));
    await expect(adapter.transcribe(media)).rejects.toMatchObject({code:"VOICE_UNRECOGNIZED"});
  });
  it("does not silently route unsupported Anthropic speech but accepts explicit speech configuration",async()=>{
    const fetcher=fetchResult({text:"Roman Urdu bolain"});
    const media={mimeType:"audio/wav",base64:Buffer.from("RIFF1234WAVEdata").toString("base64")};
    await expect(createAiProvider(config("anthropic"),fetcher).transcribe(media)).rejects.toMatchObject({code:"AI_INPUT_UNSUPPORTED"});
    expect(fetcher).not.toHaveBeenCalled();
    const composite=createAiProvider({...config("anthropic"),speechProvider:"groq",speechModel:"whisper-large-v3-turbo",speechApiKey:"explicit-speech-test-key"},fetcher);
    expect(await composite.transcribe(media)).toBe("Roman Urdu bolain");
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(composite.name).toBe("anthropic");
  });
  it("preserves signed draft choices on quota, refreshes ERP prices and invalidates approval",async()=>{
    const f=fixture();f.script(call("lookup_customers",{query:"Qasim"}),call("set_task_context",{customer_id:19}),call("begin_estimate_draft"),call("search_products",{query:"Popular pipe"}),call("add_draft_item",{quantity:20}),call("prepare_estimate"));
    const first=await f.core.run({message:"prepare estimate"},scope);
    expect(first.draft!.prepared).toBe(true);
    const core=new UnifiedCopilotAgent({respond:async()=>{throw new ApiError(429,"AI_PROVIDER_RATE_LIMITED","quota");}},f.tools);
    const result=await core.run({message:"40 discount karo",conversationToken:first.conversationToken,conversationId:first.conversationId},scope);
    expect(result).toMatchObject({status:"rate_limited",requiresConfirmation:false,draft:{id:first.draft!.id,prepared:false,lines:[{quantity:20,discountPercent:0,rate:{unit_price:477}}]}});
    const state=readBusinessState(result.conversationToken,scope,result.conversationId);
    expect(state.draft!.preparedRevision).toBeUndefined();expect(state.paymentPreparation).toBeUndefined();
    expect(state.draft!.lines).toHaveLength(1);expect(f.erpWrite).not.toHaveBeenCalled();
  });
});

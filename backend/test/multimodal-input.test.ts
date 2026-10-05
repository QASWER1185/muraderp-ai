import { createCanvas, PDFDocument } from "@napi-rs/canvas";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ProviderBusinessInput, type BusinessDocument } from "../src/ai-input/business-input.provider.js";
import { MultimodalAgentInput } from "../src/ai-copilot/agent/multimodal-input.js";
import { validateAgentMedia, visionContent } from "../src/ai-input/media-validation.js";
import { AiProvider } from "../src/ai-input/openai.provider.js";

export const scope={userId:"11111111-1111-4111-8111-111111111111",organizationId:"22222222-2222-4222-8222-222222222222",branchId:"33333333-3333-4333-8333-333333333333"};
export const document:BusinessDocument={customerName:"Qasim",vendorName:null,warehouseName:null,documentNumber:null,documentDate:null,currencyCode:"PKR",
  lines:[{productName:"EBOW FEMALE 25*1/2",productCode:null,brandHint:"Popular",quantity:20,unit:"PCS",unitRate:9999,discountPercent:10,confidence:.99}],
  discountPercent:10,subtotal:199980,total:179982,confidence:.99,warnings:[]};
export const png=()=>({mimeType:"image/png",base64:createCanvas(120,60).toBuffer("image/png").toString("base64")});
export function wav(silent=false){const b=Buffer.alloc(1644);b.write("RIFF");b.writeUInt32LE(b.length-8,4);b.write("WAVEfmt ",8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write("data",36);b.writeUInt32LE(1600,40);if(!silent)b.fill(12,44);return {mimeType:"audio/wav",base64:b.toString("base64")};}
function pdf(pages=1){const doc=new PDFDocument();for(let i=0;i<pages;i++){const ctx=doc.beginPage(120,60);ctx.fillText("Qasim estimate",5,20);doc.endPage();}return {mimeType:"application/pdf",base64:doc.close().toString("base64")};}
function fixture(){const provider={generate:vi.fn(async(_schema:unknown,_instructions:string,_content:unknown[])=>structuredClone(document)),transcribe:vi.fn(async()=>"قاسم کے لیے پاپولر پچیس ایم ایم پائپ چالیس فیصد ڈسکاؤنٹ پر بنا دو")};const adapter=new ProviderBusinessInput(provider);return {provider,adapter,input:new MultimodalAgentInput(adapter)};}
describe("Part 4 concrete extraction and media validation",()=>{
  it.each(["image","camera"] as const)("normalizes %s observations without granting observed prices/totals authority",async source=>{
    const f=fixture();const result=await f.input.normalize({source,media:png()},scope);
    expect(result.reviewRequired).toBe(false);expect(result.message).toContain("EBOW FEMALE");expect(result.message).toContain('"quantity":20');
    expect(result.message).not.toMatch(/9999|199980|179982|unitRate/);expect(result.extraction).toMatchObject({mediaRetained:false,document:{total:179982}});
    expect(f.provider.generate).toHaveBeenCalledOnce();expect(f.provider.transcribe).not.toHaveBeenCalled();
  });
  it("uses only STT before passing Urdu wording to the same Agent",async()=>{
    const f=fixture();const result=await f.input.normalize({source:"voice",media:wav()},scope);
    expect(result.message).toContain("قاسم");expect(result.message).not.toContain("quantity");expect(f.provider.generate).not.toHaveBeenCalled();expect(f.provider.transcribe).toHaveBeenCalledOnce();
  });
  it.each(["confidence","line confidence","warning","missing quantity","missing unit","empty lines"])("requires review for %s without inventing a field",async reason=>{
    const f=fixture(),doc=structuredClone(document);
    if(reason==="confidence")doc.confidence=.4;if(reason==="line confidence")doc.lines[0]!.confidence=.4;
    if(reason==="warning")doc.warnings=["Unreadable line"];if(reason==="missing quantity")doc.lines[0]!.quantity=null;if(reason==="missing unit")doc.lines[0]!.unit=null;if(reason==="empty lines")doc.lines=[];
    f.provider.generate.mockResolvedValue(doc);const result=await f.input.normalize({source:"image",media:png()},scope);
    expect(result.reviewRequired).toBe(true);if(reason==="missing quantity")expect(result.message).toContain('"quantity":null');
  });
  it("rasterizes a real PDF locally before provider extraction",async()=>{
    const f=fixture();await f.input.normalize({source:"image",media:pdf()},scope);
    const content=f.provider.generate.mock.calls[0]?.[2] as any;expect(content[0]).toMatchObject({type:"input_image",image_url:expect.stringMatching(/^data:image\/png;base64,/)});
  });
  it("rejects PDFs over three pages before a provider call",async()=>{const f=fixture();await expect(f.input.normalize({source:"image",media:pdf(4)},scope)).rejects.toMatchObject({code:"PDF_PAGE_LIMIT"});expect(f.provider.generate).not.toHaveBeenCalled();});
  it("rejects a corrupt PDF before sending anything to vision",async()=>{const media={mimeType:"application/pdf",base64:Buffer.from("%PDF-1.7\ncorrupt document with fake EOF\n%%EOF").toString("base64")};await expect(visionContent(await validateAgentMedia(media,"image"))).rejects.toMatchObject({code:"INVALID_MEDIA"});});
  it.each(["spoofed","truncated","oversized dimensions","empty audio","source mismatch","unsupported","invalid base64"])("rejects %s before the provider",async reason=>{
    const f=fixture();let media=png();let source:"image"|"voice"="image";
    if(reason==="spoofed")media.base64=Buffer.from("this is not a real image at all despite its name").toString("base64");
    if(reason==="truncated")media.base64=Buffer.from(media.base64,"base64").subarray(0,40).toString("base64");
    if(reason==="oversized dimensions"){const b=Buffer.from(media.base64,"base64");b.writeUInt32BE(100000,16);media.base64=b.toString("base64");}
    if(reason==="empty audio"){media=wav(true);source="voice";}if(reason==="source mismatch")source="voice";if(reason==="unsupported")media.mimeType="image/svg+xml";if(reason==="invalid base64")media.base64="!not base64!";
    await expect(f.input.normalize({source,media},scope)).rejects.toThrow();expect(f.provider.generate).not.toHaveBeenCalled();expect(f.provider.transcribe).not.toHaveBeenCalled();
  });
  it.each(["empty","provider failure"])("fails closed on %s transcription",async kind=>{const f=fixture();if(kind==="empty")f.provider.transcribe.mockResolvedValue("");else f.provider.transcribe.mockRejectedValue(new Error("failure"));await expect(f.input.normalize({source:"voice",media:wav()},scope)).rejects.toThrow();expect(f.provider.generate).not.toHaveBeenCalled();});
  it("rejects provider-invented ERP IDs",async()=>{const f=fixture();f.provider.generate.mockResolvedValue({...document,customerId:19} as any);await expect(f.input.normalize({source:"image",media:png()},scope)).rejects.toThrow();});
  it("bounds normalized input without truncating document lines",async()=>{const f=fixture();await expect(f.input.normalize({source:"image",media:png(),message:"x".repeat(4000)},scope)).rejects.toMatchObject({code:"INPUT_CONTEXT_LIMIT"});});
});
describe("Part 4 Groq production transport",()=>{
  const config={provider:"groq" as const,apiKey:"fixture-key",model:"text-model",visionModel:"vision-model",speechModel:"speech-model"};
  const response=(body:unknown)=>new Response(JSON.stringify(body),{status:200});
  it("uses Chat Completions vision JSON and validates locally",async()=>{
    const fetcher=vi.fn<typeof fetch>(async()=>response({choices:[{finish_reason:"stop",message:{content:'{"value":"read"}'}}]}));
    const provider=new AiProvider(config,fetcher);await expect(provider.generate(z.strictObject({value:z.string()}),"Extract",[{type:"input_image",image_url:"data:image/png;base64,fixture"},{type:"input_text",text:"read"}])).resolves.toEqual({value:"read"});
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body=JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string);expect(body).toMatchObject({model:"vision-model",response_format:{type:"json_object"}});expect(body.messages[1].content[0].image_url.url).toMatch(/^data:/);
  });
  it.each(["length","invalid JSON","unexpected field"])("rejects %s vision output",async reason=>{
    const fetcher=vi.fn(async()=>response({choices:[{finish_reason:reason==="length"?"length":"stop",message:{content:reason==="invalid JSON"?"bad":'{"value":"read","id":26}'}}]}));
    await expect(new AiProvider(config,fetcher).generate(z.strictObject({value:z.string()}),"Extract",[{type:"input_image",image_url:"fixture"}])).rejects.toMatchObject({code:"AI_INVALID_OUTPUT"});
  });
  it("rejects high no-speech probability even if the provider hallucinates words",async()=>{
    const fetcher=vi.fn<typeof fetch>(async()=>response({text:"thank you",segments:[{no_speech_prob:.99}]}));await expect(new AiProvider(config,fetcher).transcribe(wav())).rejects.toThrow();
    expect((fetcher.mock.calls[0]?.[1]?.body as FormData).get("response_format")).toBe("verbose_json");
  });
});

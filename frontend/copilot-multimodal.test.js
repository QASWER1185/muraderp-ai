import { afterEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({context:{organizationId:"org",branchId:"branch"},ask:vi.fn(),media:vi.fn(),prepare:vi.fn(),confirm:vi.fn()}));
vi.mock("./workspace-context.js",()=>({getWorkspaceContext:()=>mocks.context}));
vi.mock("./copilot-api.js",()=>({askCopilot:mocks.ask,askCopilotMedia:mocks.media,prepareConversationDraft:mocks.prepare,prepareConversationPayment:vi.fn(),confirmCopilotDraft:mocks.confirm,createCopilotDraft:vi.fn(),createCopilotReview:vi.fn(),quoteCopilotEstimateLine:vi.fn(),createCopilotRateListDraft:vi.fn(),extractInvoiceDocument:vi.fn()}));
import { mountCopilot,validateAttachment,ambiguityMarkup,extractionMarkup,conversationDraftMarkup } from "./copilot-ui.js";
function setup(){
  mocks.context={organizationId:"org",branchId:"branch"};Object.values(mocks).filter(value=>typeof value?.mockReset==="function").forEach(value=>value.mockReset());
  const response={data:{answer:"Verified ERP draft",conversationToken:"signed",conversationId:"id",toolNames:["search_products"],draft:{customer:{name:"Qasim"},lines:[{productName:"Popular",quantity:20,unit:"PCS",discountPercent:10,rate:{currency_code:"PKR",unit_price:200,unit:"PCS"},amount:3600}],currencyCode:"PKR",totals:{subtotal:4000,discount_total:400,grand_total:3600},prepared:true}}};
  mocks.media.mockResolvedValue(response);mocks.ask.mockResolvedValue(response);mocks.prepare.mockResolvedValue({data:{id:"action",idempotencyKey:"server-key"},draft:response.data.draft});mocks.confirm.mockResolvedValue({verified:true,data:{result:{id:1}}});
  const nodes=new Map();let messages=[];
  function node(){return {innerHTML:"",value:"",style:{},dataset:{},listeners:new Map(),classList:{toggle:vi.fn(),remove:vi.fn(),add:vi.fn()},addEventListener(name,callback){this.listeners.set(name,callback);},focus:vi.fn(),click:vi.fn(),setAttribute:vi.fn(),remove(){messages=messages.filter(value=>value!==this);},scrollTo:vi.fn(),querySelector:()=>null,querySelectorAll:()=>[],append(message){messages.push(message);},showModal:vi.fn(),close:vi.fn()};}
  const query=selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);};
  const thread=query("#copilot-thread");thread.querySelectorAll=selector=>messages.filter(message=>selector.split(",").some(part=>{const attribute=part.trim().match(/^\[([^\]]+)\]/)?.[1];return attribute?message.innerHTML.includes(attribute):part.trim()===".confirmation-card"&&message.innerHTML.includes('class="confirmation-card"');}));
  vi.stubGlobal("document",{querySelector:query,createElement:()=>node()});vi.stubGlobal("requestAnimationFrame",callback=>callback());vi.stubGlobal("navigator",{onLine:true});
  vi.stubGlobal("URL",{createObjectURL:vi.fn(()=>"blob:fixture"),revokeObjectURL:vi.fn()});
  const controller=mountCopilot({getAuthenticatedUserId:()=>"user"});query("#copilot-action").value="auto";
  const idle=()=>vi.waitFor(()=>expect(query("#copilot-send").disabled).toBe(false));
  const send=async(text="")=>{query("#copilot-input").value=text;query("#copilot-send").listeners.get("click")();await idle();};
  const attach=(file,camera=false)=>{const input=query(camera?"#copilot-camera":"#copilot-file");input.files=[file];input.listeners.get("change")();};
  const click=async(selector,target={dataset:{},remove:vi.fn()})=>{thread.listeners.get("click")({target:{closest:requested=>requested===selector?target:null}});await idle();};
  return {query,controller,send,attach,click,idle,markup:()=>messages.map(message=>message.innerHTML).join("\n")};
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
const image=()=>new File(["real fixture bytes"],"estimate.png",{type:"image/png"});
describe("Part 4 multimodal browser workflow",()=>{
  it.each(["image","camera","voice"])("sends %s to the same signed conversation and keeps confirmation separate",async source=>{
    const f=setup();await f.send("Qasim estimate");f.attach(source==="voice"?new File(["audio"],"note.webm",{type:"audio/webm;codecs=opus"}):image(),source==="camera");await f.send("continue");
    expect(mocks.media).toHaveBeenCalledWith(expect.objectContaining({source,conversationToken:"signed",conversationId:"id",media:{mimeType:source==="voice"?"audio/webm":"image/png",base64:expect.any(String)}}),"org","branch");
    expect(f.markup()).toContain("Subtotal: PKR 4000.00");expect(f.markup()).toContain("Discount: PKR 400.00");expect(f.markup()).toContain("ERP tools completed");expect(mocks.confirm).not.toHaveBeenCalled();expect(mocks.prepare).not.toHaveBeenCalled();
    await f.click("[data-prepare-conversation-draft]");expect(mocks.prepare).toHaveBeenCalledWith("signed","id","org","branch");expect(mocks.confirm).not.toHaveBeenCalled();await f.click("[data-confirm-draft]");expect(mocks.confirm).toHaveBeenCalledOnce();
  });
  it("offers a signed candidate and returns it with the conversation identity",async()=>{
    const f=setup();mocks.ask.mockResolvedValue({data:{answer:"Which?",conversationToken:"signed",conversationId:"id",clarification:{kind:"product",candidates:[{id:26,name:"Popular"},{id:27,name:"Dura"}]}}});
    await f.send("pipe");expect(f.markup()).toContain("data-agent-candidate");await f.click("[data-agent-candidate]",{dataset:{candidateKind:"product",agentCandidate:"27"}});
    expect(mocks.ask).toHaveBeenLastCalledWith(expect.any(String),"org","branch","signed","id",{kind:"product",id:27});
  });
  it("keeps media and wording for retry after a provider failure",async()=>{
    const f=setup();f.attach(image());mocks.media.mockRejectedValueOnce(new Error("Provider unavailable"));await f.send("Qasim");
    expect(f.query("#copilot-input").value).toBe("Qasim");expect(f.query("#copilot-attachment").hidden).toBe(false);
    await f.click("[data-copilot-retry]");expect(mocks.media).toHaveBeenCalledTimes(2);expect(f.query("#copilot-attachment").hidden).toBe(true);
  });
  it("discards late media responses after reset",async()=>{
    const f=setup();let finish;mocks.media.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));f.attach(image());f.query("#copilot-send").listeners.get("click")();await vi.waitFor(()=>expect(mocks.media).toHaveBeenCalledOnce());
    f.controller.reset();finish({data:{answer:"STALE RESULT",conversationToken:"stale",conversationId:"id"}});await new Promise(resolve=>setTimeout(resolve,0));expect(f.markup()).not.toContain("STALE RESULT");await f.send("fresh");expect(mocks.ask).toHaveBeenLastCalledWith("fresh","org","branch",null,null,undefined);
  });
  it("retains media and wording after HTTP 200 quota failure and retries with the updated signed context",async()=>{
    const f=setup();await f.send("existing estimate");f.attach(image());
    mocks.media.mockResolvedValueOnce({data:{answer:"Provider quota reached",status:"rate_limited",conversationToken:"quota-signed",conversationId:"id",draft:{id:"same",lines:[],prepared:false}}});
    await f.send("change discount");
    expect(f.query("#copilot-input").value).toBe("change discount");
    expect(f.query("#copilot-attachment").hidden).toBe(false);
    expect(f.markup()).toContain("temporarily rate limited");
    expect(f.markup()).not.toContain("data-prepare-conversation-draft");
    expect(mocks.prepare).not.toHaveBeenCalled();expect(mocks.confirm).not.toHaveBeenCalled();
    await f.click("[data-copilot-retry]");
    expect(mocks.media).toHaveBeenLastCalledWith(expect.objectContaining({message:"change discount",conversationToken:"quota-signed",conversationId:"id"}),"org","branch");
    expect(f.query("#copilot-attachment").hidden).toBe(true);
  });
  it("discards late approval preparation after reset",async()=>{
    const f=setup();await f.send("estimate");let finish;mocks.prepare.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=f.click("[data-prepare-conversation-draft]");await vi.waitFor(()=>expect(mocks.prepare).toHaveBeenCalledOnce());f.controller.reset();
    finish({data:{id:"stale",idempotencyKey:"stale"},draft:{lines:[],prepared:true,totals:{grand_total:0}}});await pending;
    expect(f.markup()).not.toContain("data-confirm-draft");await f.click("[data-confirm-draft]");expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("continues corrected weak OCR through text with the same signed identity",async()=>{
    const f=setup();mocks.media.mockResolvedValue({data:{answer:"Review",conversationToken:"signed",conversationId:"id",reviewText:"Correct quantity",extraction:{document:{customerName:"Qasim",confidence:.2,lines:[],warnings:["Unclear"],total:null}}}});
    f.attach(image());await f.send();expect(f.markup()).toContain("data-use-reviewed-input");expect(mocks.prepare).not.toHaveBeenCalled();
    const card={querySelector:()=>({value:"Qasim Popular 20 PCS estimate"})};
    f.query("#copilot-thread").listeners.get("click")({target:{closest:selector=>selector==="[data-use-reviewed-input]"?{}:selector==="[data-input-review]"?card:null}});await f.idle();
    expect(mocks.ask).toHaveBeenLastCalledWith("Qasim Popular 20 PCS estimate","org","branch","signed","id",undefined);
  });
  it("rejects a late response from a changed workspace",async()=>{
    const f=setup();mocks.media.mockImplementation(async()=>{mocks.context={organizationId:"other",branchId:"other"};return {data:{answer:"PRIVATE RESULT",conversationToken:"private",conversationId:"id"}};});f.attach(image());await f.send();
    expect(f.markup()).not.toContain("PRIVATE RESULT");expect(f.markup()).toContain("Workspace changed");
  });
  it("blocks empty and unsupported attachments before sending",async()=>{
    const f=setup();f.attach(new File([],"empty.wav",{type:"audio/wav"}));await f.send();expect(mocks.media).not.toHaveBeenCalled();expect(f.markup()).toContain("attachment is empty");
    f.attach(new File(["svg"],"bad.svg",{type:"image/svg+xml"}));expect(f.markup()).toContain("supported audio file");
  });
});
describe("Part 4 untrusted display and bounded attachments",()=>{
  it("escapes candidate labels and observed text",()=>{
    expect(ambiguityMarkup({kind:"product",candidates:[{id:26,name:"<img onerror=evil>"}]})).not.toContain("<img");
    expect(extractionMarkup({transcript:"<script>evil</script>"})).toContain("&lt;script&gt;");
    expect(extractionMarkup({document:{customerName:"<svg>",confidence:.5,lines:[],warnings:[],total:9999}},'<script>')).toContain("&lt;script&gt;");
  });
  it("shows absent optional totals as unavailable without fabricating zero",()=>{
    const text=conversationDraftMarkup({lines:[],currencyCode:"PKR",totals:{grand_total:40}});expect(text).toContain("Subtotal: PKR unavailable");expect(text).toContain("Discount: PKR unavailable");
  });
  it("normalizes recorder MIME parameters and enforces size",()=>{
    expect(validateAttachment({type:"audio/webm;codecs=opus",size:12})).toBe("audio/webm");expect(()=>validateAttachment({type:"image/png",size:8*1024*1024+1})).toThrow("8 MB");
  });
});
describe("Part 4 microphone cleanup",()=>{
  function recording(f){
    const stop=vi.fn(),stream={getTracks:()=>[{stop}]};let active;
    class Recorder{state="inactive";mimeType="audio/webm;codecs=opus";listeners=new Map();static isTypeSupported=()=>true;constructor(){active=this;}addEventListener(name,callback){this.listeners.set(name,callback);}start(){this.state="recording";}stop(){this.state="inactive";queueMicrotask(()=>this.listeners.get("stop")());}data(){this.listeners.get("dataavailable")({data:new Blob(["audio"],{type:this.mimeType})});}}
    vi.stubGlobal("MediaRecorder",Recorder);navigator.mediaDevices={getUserMedia:vi.fn(async()=>stream)};
    return {stop,active:()=>active,start:async()=>{f.query("#copilot-mic").listeners.get("click")();await vi.waitFor(()=>expect(active?.state).toBe("recording"));}};
  }
  it("releases the microphone and sends the recorded file through STT",async()=>{
    const f=setup(),r=recording(f);await r.start();r.active().data();f.query("#copilot-mic").listeners.get("click")();await f.idle();expect(r.stop).toHaveBeenCalled();expect(f.query("#copilot-attachment").hidden).toBe(false);await f.send();expect(mocks.media.mock.calls[0][0]).toMatchObject({source:"voice",media:{mimeType:"audio/webm"}});
  });
  it("reset releases the microphone and ignores late stop attachments",async()=>{
    const f=setup(),r=recording(f);await r.start();r.active().data();f.controller.reset();await new Promise(resolve=>setTimeout(resolve,0));expect(r.stop).toHaveBeenCalled();expect(f.query("#copilot-attachment").hidden).toBe(true);
  });
  it("cleans up when recorder construction fails",async()=>{
    const f=setup(),stop=vi.fn();navigator.mediaDevices={getUserMedia:vi.fn(async()=>({getTracks:()=>[{stop}]}))};vi.stubGlobal("MediaRecorder",class {static isTypeSupported=()=>false;constructor(){throw new Error("codec unavailable");}});
    f.query("#copilot-mic").listeners.get("click")();await f.idle();expect(stop).toHaveBeenCalled();expect(f.markup()).toContain("codec unavailable");
  });
});

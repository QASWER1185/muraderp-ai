import { afterEach,describe,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({context:{organizationId:"org",branchId:"branch"},ask:vi.fn(),prepare:vi.fn(),confirm:vi.fn()}));
vi.mock("./workspace-context.js",()=>({getWorkspaceContext:()=>mocks.context}));
vi.mock("./copilot-api.js",()=>({askCopilot:mocks.ask,prepareConversationPayment:mocks.prepare,confirmCopilotDraft:mocks.confirm,prepareConversationDraft:vi.fn(),createCopilotDraft:vi.fn(),createCopilotReview:vi.fn(),quoteCopilotEstimateLine:vi.fn(),createCopilotRateListDraft:vi.fn(),extractInvoiceDocument:vi.fn()}));
import { mountCopilot } from "./copilot-ui.js";
const preparation={intent:"customer_payment",partyName:"Qasim",payment:{amount:200,currency_code:"PKR",payment_date:"2026-10-05",payment_method:"CASH",allocations:[{invoice_id:501,amount:200}]}};
function setup(){
  mocks.context={organizationId:"org",branchId:"branch"};mocks.ask.mockReset();mocks.prepare.mockReset();mocks.confirm.mockReset();
  mocks.ask.mockResolvedValue({data:{answer:"Nothing executed.\n\nReview payment.",conversationToken:"signed",conversationId:"id",paymentPreparation:preparation}});
  mocks.prepare.mockResolvedValue({data:{id:"action",idempotencyKey:"server-key"},paymentPreparation:preparation});
  mocks.confirm.mockResolvedValue({verified:true,data:{result:{id:701}}});
  const nodes=new Map();let messages=[];
  function node(){return {innerHTML:"",value:"",style:{},dataset:{},listeners:new Map(),classList:{toggle:vi.fn(),remove:vi.fn(),add:vi.fn()},addEventListener(name,callback){this.listeners.set(name,callback);},focus:vi.fn(),click:vi.fn(),setAttribute:vi.fn(),remove(){messages=messages.filter(value=>value!==this);},scrollTo:vi.fn(),querySelector:()=>null,querySelectorAll:()=>[],append(message){messages.push(message);},showModal:vi.fn(),close:vi.fn()};}
  const query=selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);};
  const thread=query("#copilot-thread");
  thread.querySelectorAll=selector=>messages.filter(message=>selector.split(",").some(part=>{const attribute=part.trim().match(/^\[([^\]]+)\]/)?.[1];return attribute?message.innerHTML.includes(attribute):part.trim()===".confirmation-card"&&message.innerHTML.includes('class="confirmation-card"');}));
  vi.stubGlobal("document",{querySelector:query,createElement:()=>node()});
  vi.stubGlobal("requestAnimationFrame",callback=>callback());vi.stubGlobal("navigator",{onLine:true});
  mountCopilot({getAuthenticatedUserId:()=>"user"});query("#copilot-action").value="auto";
  const send=async(text)=>{query("#copilot-input").value=text;query("#copilot-send").listeners.get("click")();await vi.waitFor(()=>expect(query("#copilot-send").disabled).toBe(false));};
  const click=async(selector)=>{thread.listeners.get("click")({target:{closest:requested=>requested===selector?{dataset:{},remove:vi.fn()}:null}});await vi.waitFor(()=>expect(query("#copilot-send").disabled).toBe(false));};
  return {send,click,markup:()=>messages.map(message=>message.innerHTML).join("\n")};
}
afterEach(()=>vi.unstubAllGlobals());
describe("Part 3 actual chat payment review lifecycle",()=>{
  it("requires Prepare and separate Confirm clicks, then uses the server action ID/key",async()=>{
    const f=setup();await f.send("Receive 200 CASH from Qasim, invoice 501, today");
    expect(f.markup()).toContain("Customer receipt");expect(f.markup()).toContain("data-prepare-conversation-payment");
    expect(mocks.prepare).not.toHaveBeenCalled();expect(mocks.confirm).not.toHaveBeenCalled();
    await f.click("[data-prepare-conversation-payment]");expect(mocks.prepare).toHaveBeenCalledWith("signed","id","org","branch");
    expect(f.markup()).toContain("Payment ready for confirmation");expect(mocks.confirm).not.toHaveBeenCalled();
    await f.click("[data-confirm-draft]");expect(mocks.confirm).toHaveBeenCalledWith({id:"action",organizationId:"org",branchId:"branch",idempotencyKey:"server-key",intent:"customer_payment",userId:"user"});
    expect(f.markup()).toContain("Verified in ERP");
  });
  it("blocks confirmation after a workspace/branch change",async()=>{
    const f=setup();await f.send("receipt");await f.click("[data-prepare-conversation-payment]");mocks.context={organizationId:"org",branchId:"other"};
    await f.click("[data-confirm-draft]");expect(mocks.confirm).not.toHaveBeenCalled();expect(f.markup()).toContain("Return to the draft");
  });
  it("removes stale preparation and confirmation after a new conversation request",async()=>{
    const f=setup();await f.send("receipt");await f.click("[data-prepare-conversation-payment]");
    mocks.ask.mockResolvedValue({data:{answer:"Ledger",conversationToken:"fresh",conversationId:"id"}});await f.send("ledger");
    expect(f.markup()).not.toContain("data-confirm-draft");expect(f.markup()).not.toContain("data-prepare-conversation-payment");
    await f.click("[data-confirm-draft]");expect(mocks.confirm).not.toHaveBeenCalled();
  });
});

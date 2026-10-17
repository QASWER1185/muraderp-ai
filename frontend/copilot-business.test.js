import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareConversationPayment } from "./copilot-api.js";
import { conversationPaymentMarkup } from "./copilot-ui.js";

const payment={intent:"customer_payment",partyName:"Qasim <script>",payment:{amount:200,currency_code:"PKR",payment_date:"2026-10-05",payment_method:"CASH",allocations:[{invoice_id:501,amount:200}]}};
afterEach(()=>vi.unstubAllGlobals());
describe("Part 3 payment browser contracts",()=>{
  it("sends only signed context to the browser-session payment preparation endpoint",async()=>{
    const fetch=vi.fn(async()=>({ok:true,json:async()=>({data:{status:"DRAFT"}})}));vi.stubGlobal("fetch",fetch);
    await prepareConversationPayment("signed","conversation","org","branch");
    const [url,options]=fetch.mock.calls[0];
    expect(url).toBe("/api/v1/ai/copilot/conversation/payments");expect(options.credentials).toBe("include");
    expect(options.headers).toMatchObject({"X-Organization-Id":"org","X-Branch-Id":"branch"});
    expect(JSON.parse(options.body)).toEqual({conversationToken:"signed",conversationId:"conversation"});
  });
  it("shows amount, receipt direction, method/date and explicit invoice allocations before preparation",()=>{
    const markup=conversationPaymentMarkup(payment);
    expect(markup).toContain("Customer receipt");expect(markup).toContain("Qasim &lt;script&gt;");expect(markup).toContain("PKR 200");
    expect(markup).toContain("2026-10-05");expect(markup).toContain("CASH");expect(markup).toContain("Invoice 501: 200");
    expect(markup).toContain("data-prepare-conversation-payment");expect(markup).not.toContain("data-confirm-draft");
  });
  it("does not invent a vendor currency and makes payment direction clear",()=>{
    const markup=conversationPaymentMarkup({intent:"vendor_payment",partyName:"Supplier",payment:{amount:200,payment_date:"2026-10-05",payment_method:"BANK",allocations:[{purchase_id:601,amount:200}]}},true);
    expect(markup).toContain("Vendor payment");expect(markup).toContain("Currency is not tracked");expect(markup).not.toContain("PKR");
    expect(markup).toContain("Purchase 601: 200");expect(markup).toContain("pays a vendor");expect(markup).not.toContain("data-prepare-conversation-payment");
  });
});

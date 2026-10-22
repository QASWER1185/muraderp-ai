import { afterEach, describe, expect, it, vi } from "vitest";
import { askCopilot, prepareConversationDraft } from "./copilot-api.js";
import { conversationDraftMarkup, createCopilotConversation } from "./copilot-ui.js";

afterEach(() => vi.unstubAllGlobals());
describe("stateful estimate conversation", () => {
  it("restores only scoped signed context across reloads without extending its expiry",()=>{
    let now=0;const entries=new Map();const storage={getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
    createCopilotConversation(()=>now,storage).accept("signed","user","org","branch","conversation-id");
    now=10*60_000;const restored=createCopilotConversation(()=>now,storage);
    expect(restored.tokenFor("user","org","branch")).toBe("signed");expect(restored.idFor("user","org","branch")).toBe("conversation-id");
    expect(restored.tokenFor("another-user","org","branch")).toBeNull();expect(entries.size).toBe(0);
    createCopilotConversation(()=>now,storage).accept("signed","user","org","branch","conversation-id");
    now=40*60_000;expect(createCopilotConversation(()=>now,storage).tokenFor("user","org","branch")).toBeNull();expect(entries.size).toBe(0);
  });
  it("prepares with signed context only and browser credentials", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: { status: "DRAFT" } }) }));
    vi.stubGlobal("fetch", fetch);
    await prepareConversationDraft("signed", "conversation-id", "org", "branch");
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("/api/v1/ai/copilot/conversation/drafts");
    expect(options.credentials).toBe("include");
    expect(options.headers).toMatchObject({ "X-Organization-Id": "org", "X-Branch-Id": "branch" });
    expect(JSON.parse(options.body)).toEqual({ conversationToken: "signed", conversationId: "conversation-id" });
  });
  it("continues an Urdu request with the same conversation identity", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) }));
    vi.stubGlobal("fetch", fetch);
    await askCopilot("اس کے 20 میٹر", "org", "branch", "signed", "conversation-id");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ message: "اس کے 20 میٹر", conversationToken: "signed", conversationId: "conversation-id" });
  });
  it("clears both token and identity on scope changes, expiration and reset", () => {
    let now = 0;
    const state = createCopilotConversation(() => now);
    const accept = () => state.accept("signed", "user", "org", "branch", "id");
    accept(); expect(state.idFor("user", "org", "branch")).toBe("id");
    expect(state.idFor("user", "org", "other-branch")).toBeNull();
    accept(); expect(state.idFor("other-user", "org", "branch")).toBeNull();
    accept(); expect(state.idFor("user", "other-org", "branch")).toBeNull();
    accept(); now = 30 * 60_000; expect(state.idFor("user", "org", "branch")).toBeNull();
    accept(); state.clear(); expect(state.tokenFor("user", "org", "branch")).toBeNull();
    expect(state.idFor("user", "org", "branch")).toBeNull();
  });
  it("renders escaped server rates and discounted totals before a separate preparation step", () => {
    const markup = conversationDraftMarkup({ prepared: true, customer: { name: "Qasim" }, currencyCode: "PKR", totals: { grand_total: 8586 },
      lines: [{ productName: "Pipe <script>", quantity: 20, unit: "MTR", discountPercent: 10, amount: 8586, rate: { currency_code: "PKR", unit_price: 477, unit: "MTR" } }] });
    expect(markup).toContain("PKR 477 / MTR");
    expect(markup).toContain("PKR 8586.00");
    expect(markup).toContain("رعایت 10%");
    expect(markup).toContain("Pipe &lt;script&gt;");
    expect(markup).toContain("data-prepare-conversation-draft");
    expect(markup).not.toContain("data-confirm-draft");
  });
  it("keeps missing rates and totals unavailable and does not offer preparation", () => {
    const markup = conversationDraftMarkup({ prepared: false, totals: null, lines: [{ productName: "Pipe", quantity: 20, unit: "MTR", discountPercent: 0, rate: null, amount: null }] });
    expect(markup).toContain("فعال نرخ واضح کر دیں");
    expect(markup).toContain("تمام لائنوں کے درست نرخ");
    expect(markup).not.toContain("data-prepare-conversation-draft");
  });
});

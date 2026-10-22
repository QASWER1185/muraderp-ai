import { afterEach, describe, expect, it, vi } from "vitest";

const context = { organizationId: "22222222-2222-4222-8222-222222222222", branchId: "33333333-3333-4333-8333-333333333333" };
const api = vi.hoisted(() => ({ askCopilot: vi.fn(), confirmCopilotDraft: vi.fn() }));
vi.mock("./workspace-context.js", () => ({ getWorkspaceContext: () => context }));
vi.mock("./copilot-api.js", () => ({ ...api, createCopilotDraft: vi.fn(), createCopilotReview: vi.fn(), quoteCopilotEstimateLine: vi.fn(), createCopilotRateListDraft: vi.fn(), extractInvoiceDocument: vi.fn() }));
import { mountCopilot } from "./copilot-ui.js";

function element() {
  return { listeners: {}, children: [], value: "", style: {}, innerHTML: "", dataset: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    append(child) { this.children.push(child); }, querySelector: () => null, querySelectorAll: () => [],
    scrollTo() {}, focus() {}, remove() {}, showModal() {}, close() {} };
}
function setup() {
  vi.clearAllMocks();
  const elements = new Map();
  const select = (name) => { if (!elements.has(name)) elements.set(name, element()); return elements.get(name); };
  vi.stubGlobal("document", { querySelector: select, createElement: element });
  vi.stubGlobal("requestAnimationFrame", (callback) => callback());
  vi.stubGlobal("navigator", { onLine: true });
  let user = "user-a";
  mountCopilot({ getAuthenticatedUserId: () => user });
  select("#copilot-action").value = "auto";
  const send = (text) => { select("#copilot-input").value = text; select("#copilot-send").listeners.click(); };
  const confirm = () => select("#copilot-thread").listeners.click({ target: { closest: (selector) => selector === "[data-confirm-draft]" ? {} : null } });
  const prepare = (details) => select("#copilot-thread").listeners.click({ target: { closest: (selector) => selector === "[data-prepare-customer]" ? {} : selector === "[data-customer-preparation]" ? { querySelector: (field) => ({ value: details[field.match(/name="(\w+)"/)[1]] ?? "" }) } : null } });
  const markup = () => select("#copilot-thread").children.map((item) => item.innerHTML).join("\n");
  return { send, confirm, prepare, markup, changeUser: (next) => { user = next; } };
}
const review = { intent: "customer_create", draftId: "draft-1", idempotencyKey: "server-preparation-key", name: "ALI HASSAN", phone: "03216175000", city: "LAHORE", requiresConfirmation: true };
afterEach(() => vi.unstubAllGlobals());

describe("conversational customer confirmation integration", () => {
  it("renders required details and sends them to preparation without confirming a write", async () => {
    api.askCopilot.mockResolvedValueOnce({ data: { answer: "Please provide required details", conversationToken: "details-token", preparation: { intent: "customer_create", requiredFields: ["name", "phone", "city"] } } })
      .mockResolvedValueOnce({ data: { answer: "Review first", review }, requiresConfirmation: true });
    const ui = setup();
    ui.send("ALI HASSAN KO AS NEW CUSTOMER ADD KARO");
    await vi.waitFor(() => expect(ui.markup()).toContain("Prepare customer review"));
    expect(ui.markup()).toContain('type="tel"');
    expect(api.confirmCopilotDraft).not.toHaveBeenCalled();
    ui.prepare({ name: "ALI HASSAN", phone: "03216175000", city: "LAHORE" });
    await vi.waitFor(() => expect(ui.markup()).toContain("Confirm customer creation"));
    expect(api.askCopilot).toHaveBeenLastCalledWith('Prepare a new customer for review: {"name":"ALI HASSAN","phone":"03216175000","city":"LAHORE"}', context.organizationId, context.branchId, "details-token", null, undefined);
    expect(api.confirmCopilotDraft).not.toHaveBeenCalled();
  });
  it("blocks incomplete details before any preparation API request", async () => {
    api.askCopilot.mockResolvedValue({ data: { answer: "Details needed", preparation: { intent: "customer_create" } } });
    const ui = setup(); ui.send("Add a new customer");
    await vi.waitFor(() => expect(ui.markup()).toContain("Prepare customer review"));
    ui.prepare({ name: "ALI HASSAN", phone: "", city: "LAHORE" });
    await vi.waitFor(() => expect(ui.markup()).toContain("نام، فون نمبر اور شہر"));
    expect(api.askCopilot).toHaveBeenCalledOnce();
    expect(api.confirmCopilotDraft).not.toHaveBeenCalled();
  });
  it("blocks preparation after the authenticated user changes", async () => {
    api.askCopilot.mockResolvedValue({ data: { answer: "Details needed", preparation: { intent: "customer_create" } } });
    const ui = setup(); ui.send("Add a new customer");
    await vi.waitFor(() => expect(ui.markup()).toContain("Prepare customer review"));
    ui.changeUser("user-b"); ui.prepare({ name: "ALI HASSAN", phone: "03216175000", city: "LAHORE" });
    await vi.waitFor(() => expect(ui.markup()).toContain("اصل صارف اور ورک اسپیس"));
    expect(api.askCopilot).toHaveBeenCalledOnce();
    expect(api.confirmCopilotDraft).not.toHaveBeenCalled();
  });
  it("collects missing fields, renders the returned draft, and confirms only after the click", async () => {
    api.askCopilot.mockResolvedValueOnce({ data: { answer: "Please provide phone number and city", conversationToken: "customer-context" } })
      .mockResolvedValueOnce({ data: { answer: "Review the customer", conversationToken: "draft-context", review }, requiresConfirmation: true });
    api.confirmCopilotDraft.mockResolvedValue({ verified: true, data: { result: { id: 101 } } });
    const ui = setup();
    ui.send("ALI HASSAN KO AS NEW CUSTOMER ADD KARO");
    await vi.waitFor(() => expect(ui.markup()).toContain("Please provide phone"));
    expect(api.confirmCopilotDraft).not.toHaveBeenCalled();
    ui.send("03216175000 LAHORE");
    await vi.waitFor(() => expect(ui.markup()).toContain("Confirm customer creation"));
    expect(api.askCopilot).toHaveBeenLastCalledWith("03216175000 LAHORE", context.organizationId, context.branchId, "customer-context", null, undefined);
    expect(ui.markup()).toContain("03216175000");
    expect(api.confirmCopilotDraft).not.toHaveBeenCalled();
    ui.confirm();
    await vi.waitFor(() => expect(api.confirmCopilotDraft).toHaveBeenCalledOnce());
    expect(api.confirmCopilotDraft).toHaveBeenCalledWith({ id: "draft-1", idempotencyKey: "server-preparation-key", intent: "customer_create", ...context, userId: "user-a" });
    await vi.waitFor(() => expect(ui.markup()).toContain("Verified in ERP"));
  });

  it("does not confirm a prepared draft after the authenticated user changes", async () => {
    api.askCopilot.mockResolvedValue({ data: { answer: "Review the customer", review }, requiresConfirmation: true });
    const ui = setup();
    ui.send("Prepare a new customer");
    await vi.waitFor(() => expect(ui.markup()).toContain("Confirm customer creation"));
    ui.changeUser("user-b");
    ui.confirm();
    await vi.waitFor(() => expect(ui.markup()).toContain("اصل صارف اور ورک اسپیس"));
    expect(api.confirmCopilotDraft).not.toHaveBeenCalled();
  });
});

// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ testCopilotProvider: vi.fn() }));
vi.mock("./workspace-context.js", () => ({ getWorkspaceContext: () => null }));
vi.mock("./copilot-api.js", () => ({ ...api, getCopilotProviderStatus: vi.fn(), createCopilotDraft: vi.fn(), createCopilotReview: vi.fn(), askCopilot: vi.fn(), askCopilotMedia: vi.fn(), prepareConversationDraft: vi.fn(), prepareConversationPayment: vi.fn(), quoteCopilotEstimateLine: vi.fn(), createCopilotRateListDraft: vi.fn(), extractInvoiceDocument: vi.fn(), confirmCopilotDraft: vi.fn() }));
import { mountCopilot } from "./copilot-ui.js";
beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = readFileSync(new NodeURL("./index.html", import.meta.url), "utf8").match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  mountCopilot({ getAuthenticatedUserId: () => "user" });
});
afterEach(() => { document.body.innerHTML = ""; });
describe("Copilot key connection test", () => {
  it("shows success only after the provider confirms a connection", async () => {
    api.testCopilotProvider.mockResolvedValue({data:{connected:true,httpStatus:200}});
    document.querySelector("#copilot-key-test").click();
    await vi.waitFor(() => expect(document.querySelector("#copilot-key-result").textContent).toContain("AI connection verified"));
    expect(document.querySelector("#copilot-key-result").textContent).toContain("HTTP 200");
    expect(document.querySelector("#copilot-key-result").dataset.state).toBe("success");
    expect(document.querySelector("#copilot-key-test").disabled).toBe(false);
  });
  it("shows the safe provider error instead of treating a saved key as verified", async () => {
    api.testCopilotProvider.mockRejectedValue(new Error("The configured AI model is unavailable."));
    document.querySelector("#copilot-key-test").click();
    await vi.waitFor(() => expect(document.querySelector("#copilot-key-result").textContent).toBe("The configured AI model is unavailable."));
    expect(document.querySelector("#copilot-key-test").disabled).toBe(false);
  });
});

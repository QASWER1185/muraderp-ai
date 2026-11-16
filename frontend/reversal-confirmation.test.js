// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { mountRecordDeletion, deletionSummaryMarkup } from "./record-deletion.js";
const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); document.body.innerHTML = ""; });
it("escapes reversal summaries and displays blocking stock, ledger and balance impact", () => {
  const markup = deletionSummaryMarkup({ posted: true, stock: [{ product_id: 271, warehouse_id: 15, before: 0, after: -1, quantity_change: -1 }], ledger_delta: [{ code: "4000", reversal_debit: 360, reversal_credit: 0 }], blockers: ["<Negative stock>"] });
  expect(markup).toContain("0 → -1"); expect(markup).toContain("Debit 360"); expect(markup).toContain("&lt;Negative stock&gt;");
});
it("requires loaded impact and an explicit confirmation button before sending the preview fingerprint", async () => {
  sessionStorage.setItem("muraderp.workspace", JSON.stringify(context));
  // Workspace storage keys are supplied by the actual context module.
  const { setWorkspaceContext } = await import("./workspace-context.js");
  setWorkspaceContext(context);
  const fetch = vi.fn(async (url, options = {}) => ({ ok: true, json: async () => options.method === "DELETE" ? {} : url.includes("delete-preview") ? { data: { posted: true, allowed: true, fingerprint: "a".repeat(32), stock: [] } } : { data: [{ id: 15, status: "PAID", invoice_number: "Test" }] } }));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("Option", function(text,value){ const node=document.createElement("option");node.textContent=text;node.value=value;return node; });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  document.body.innerHTML = '<div class="page-heading"></div>';
  const refresh = vi.fn(); mountRecordDeletion(document.body, "invoices", refresh);
  document.querySelector("button").click();
  await vi.waitFor(() => expect(document.querySelectorAll("select[name=record] option")).toHaveLength(2));
  const select = document.querySelector("select[name=record]"), submit = document.querySelector("[type=submit]");
  expect(submit.disabled).toBe(true);
  select.value = "15"; select.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(submit.disabled).toBe(false));
  expect(submit.textContent).toBe("Confirm reversal and delete");
  expect(fetch.mock.calls.some(([, o]) => o?.method === "DELETE")).toBe(false);
  submit.click(); await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(fetch.mock.calls.find(([, o]) => o?.method === "DELETE")[1].body).toBe(JSON.stringify({ fingerprint: "a".repeat(32) }));
});

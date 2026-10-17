import { getInvoice, listInvoices } from "./invoice-api.js";
import { icon } from "./icons.js";
import { createReturn, getReturn, listReturns } from "./return-api.js";
import { listWarehouses } from "./warehouse-api.js";
import { getWorkspaceContext } from "./workspace-context.js";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const money = (value) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(Number(value) || 0);
const positiveId = (value, label) => { const number = Number(value); if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} is required.`); return number; };

export function returnErrorMessage(error) {
  if (error?.status === 401) return "Sign in to use Returns.";
  if (error?.status === 403) return "You do not have permission to use Returns in this workspace.";
  return error instanceof Error ? error.message : "Returns could not be loaded.";
}

export function returnListMarkup(notes) {
  if (!notes.length) return `<div class="empty-state">${icon("return", 26)}<h2>No returns yet</h2><p>Posted credit notes for this branch will appear here.</p></div>`;
  return `<div class="invoice-list">${notes.map((note) => `<button class="invoice-row" type="button" data-return-id="${escapeHtml(note.id)}"><span><strong>${escapeHtml(note.credit_note_number)}</strong><small>${escapeHtml(note.credit_date)} · Invoice #${escapeHtml(note.invoice_id)}</small></span><span class="status-pill neutral">${escapeHtml(note.status)}</span><strong>${money(note.grand_total)}</strong>${icon("chevron")}</button>`).join("")}</div>`;
}

export function returnDetailMarkup({ credit_note: note, items }) {
  return `<div class="side-dialog-head"><div><p class="eyebrow">Posted credit note</p><h2>${escapeHtml(note.credit_note_number)}</h2></div><button class="icon-button" type="button" data-return-close aria-label="Close">${icon("close")}</button></div>
    <dl class="detail-list"><div><dt>Status</dt><dd>${escapeHtml(note.status)}</dd></div><div><dt>Date</dt><dd>${escapeHtml(note.credit_date)}</dd></div><div><dt>Invoice</dt><dd>#${escapeHtml(note.invoice_id)}</dd></div><div><dt>Customer</dt><dd>#${escapeHtml(note.customer_id)}</dd></div><div><dt>Reason</dt><dd>${escapeHtml(note.reason)}</dd></div></dl>
    <h3>Returned items</h3><div class="invoice-detail-lines">${items.map((item) => `<div><span>Product #${escapeHtml(item.product_id)} · ${escapeHtml(item.quantity)} ${escapeHtml(item.unit)} × ${money(item.unit_price)} · Warehouse #${escapeHtml(item.warehouse_id)}</span><strong>${money(item.line_total)}</strong></div>`).join("")}</div>
    <dl class="detail-list"><div><dt>Credit total</dt><dd><strong>${money(note.grand_total)}</strong></dd></div></dl>${note.notes ? `<p class="muted">${escapeHtml(note.notes)}</p>` : ""}`;
}

export function validateReturnDraft(input, invoice) {
  if (!invoice || !["POSTED", "PARTIALLY_PAID", "PAID"].includes(invoice.invoice.status)) throw new Error("Choose a posted invoice that can be returned.");
  const number = String(input.credit_note_number ?? "").trim();
  const reason = String(input.reason ?? "").trim();
  const notes = String(input.notes ?? "").trim();
  if (!number || number.length > 100) throw new Error("A valid credit note number is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.credit_date ?? "")) throw new Error("Credit date is required.");
  if (!reason || reason.length > 500) throw new Error("A return reason is required (maximum 500 characters).");
  if (notes.length > 2000) throw new Error("Notes must be 2000 characters or fewer.");
  const available = new Map(invoice.lines.map((line) => [line.id, line]));
  const items = input.items.map((item) => {
    const invoiceItemId = positiveId(item.invoice_item_id, "Invoice line");
    const line = available.get(invoiceItemId);
    if (!line) throw new Error("Choose lines from the selected invoice.");
    const quantity = Number(item.quantity);
    if (String(item.quantity ?? "").trim() === "" || !Number.isFinite(quantity) || quantity <= 0 || quantity > Number(line.quantity)) throw new Error("Return quantity must be greater than zero and no more than the invoiced quantity.");
    return { invoice_item_id: invoiceItemId, warehouse_id: positiveId(item.warehouse_id, "Return warehouse"), quantity };
  });
  if (!items.length || items.length > 100) throw new Error("Select between 1 and 100 invoice lines to return.");
  if (new Set(items.map((item) => item.invoice_item_id)).size !== items.length) throw new Error("Each invoice line can appear only once.");
  return {
    credit_note_number: number, invoice_id: positiveId(invoice.invoice.id, "Invoice"),
    customer_id: positiveId(invoice.invoice.customer_id, "Customer"), credit_date: input.credit_date,
    currency_code: invoice.invoice.currency_code, reason, notes, items,
  };
}

function option(id, label) { return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`; }

export function mountReturns(container, options = {}) {
  const context = options.context ?? getWorkspaceContext(options.storage ?? globalThis.sessionStorage);
  let notes = [];
  let nextCursor = null;
  let invoice = null;
  let warehouses = [];
  let pendingDraft = null;
  let pendingKey = null;
  let requestVersion = 0;
  let searchTimer = null;
  container.innerHTML = `<section class="page-heading"><div><p class="eyebrow">Sales</p><h1>Returns</h1><p class="page-intro">Credit notes in your current workspace.</p></div><button class="button primary" type="button" data-return-new>+ New Return</button></section><section class="surface"><div class="section-head"><h2>Return register</h2><button class="button secondary" type="button" data-return-refresh>Refresh</button></div><label>Search credit notes<input id="return-search" type="search" placeholder="Number or invoice ID"></label><div id="return-results" aria-live="polite"></div><button class="button secondary" type="button" data-return-next hidden>Load more</button></section>
    <dialog id="return-detail" class="side-dialog"><div id="return-detail-content"></div></dialog>
    <dialog id="return-editor" class="invoice-dialog"><form id="return-form"><div class="side-dialog-head"><div><p class="eyebrow">Sales return</p><h2>New Return</h2></div><button class="icon-button" type="button" data-return-editor-close aria-label="Close">${icon("close")}</button></div><p class="muted">Posting restores stock and records a customer credit through the authoritative return service.</p><div class="invoice-entry-meta"><label>Credit note number<input name="credit_note_number" maxlength="100" required></label><label>Credit date<input name="credit_date" type="date" required></label><label>Invoice ID<input name="invoice_id" type="number" min="1" step="1" list="return-invoice-options" required><datalist id="return-invoice-options"></datalist></label><button class="button secondary" type="button" data-return-load-invoice>Load invoice</button></div><div id="return-invoice-summary"></div><div id="return-lines"></div><label>Reason<input name="reason" maxlength="500" required></label><label>Notes<textarea name="notes" maxlength="2000"></textarea></label><p id="return-form-result" class="form-message" role="alert" hidden></p><div id="return-review" hidden></div><div class="dialog-actions"><button class="button secondary" type="button" data-return-editor-close>Cancel</button><button class="button primary" type="submit" id="return-action">Review Return</button></div></form></dialog>`;
  const results = container.querySelector("#return-results");
  const search = container.querySelector("#return-search");
  const next = container.querySelector("[data-return-next]");
  const detail = container.querySelector("#return-detail");
  const editor = container.querySelector("#return-editor");
  const form = container.querySelector("#return-form");
  const message = container.querySelector("#return-form-result");
  const review = container.querySelector("#return-review");
  const action = container.querySelector("#return-action");
  const field = (name) => form.elements.namedItem(name);
  const showError = (error) => { message.textContent = returnErrorMessage(error); message.hidden = false; };
  const resetReview = () => { pendingDraft = null; pendingKey = null; review.hidden = true; action.textContent = "Review Return"; };
  const renderList = () => { results.innerHTML = returnListMarkup(notes); };

  async function load(append = false) {
    const version = ++requestVersion;
    if (!context) { results.innerHTML = `<div class="empty-state"><h2>Choose your workspace</h2><p>Choose an authorized business and branch to view returns.</p><button class="button secondary" type="button" data-open-workspace>Choose workspace</button></div>`; return; }
    if (!append) results.innerHTML = `<div class="loading-state"><span class="spinner"></span>Loading returns...</div>`;
    try {
      const page = await listReturns(context, { cursor: append ? nextCursor : undefined, search: search.value.trim() });
      if (version !== requestVersion) return;
      notes = append ? [...notes, ...page.data] : page.data;
      nextCursor = page.next_cursor;
      renderList();
      next.hidden = nextCursor == null;
    } catch (error) { if (version === requestVersion) results.innerHTML = `<div class="empty-state error-state"><h2>Returns unavailable</h2><p>${escapeHtml(returnErrorMessage(error))}</p></div>`; }
  }

  async function openDetail(id) {
    try {
      const response = await getReturn(context, id);
      container.querySelector("#return-detail-content").innerHTML = returnDetailMarkup(response.data);
      detail.showModal();
    } catch (error) { results.innerHTML = `<div class="empty-state error-state"><h2>Return unavailable</h2><p>${escapeHtml(returnErrorMessage(error))}</p></div>`; }
  }

  async function openEditor() {
    if (!context) { globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace")); return; }
    form.reset(); invoice = null; warehouses = []; resetReview(); message.hidden = true;
    container.querySelector("#return-invoice-summary").replaceChildren();
    container.querySelector("#return-lines").replaceChildren();
    field("credit_date").value = new Date().toISOString().slice(0, 10);
    editor.showModal();
    try {
      const [invoicePage, warehousePage] = await Promise.all([listInvoices(context, { limit: 100 }), listWarehouses(context, { limit: 100 })]);
      warehouses = warehousePage.data ?? [];
      container.querySelector("#return-invoice-options").innerHTML = (invoicePage.data ?? []).map((item) => option(item.id, `${item.invoice_number} · Customer #${item.customer_id}`)).join("");
      field("invoice_id").focus();
    } catch (error) { showError(error); }
  }

  async function loadInvoice() {
    resetReview(); invoice = null;
    container.querySelector("#return-lines").replaceChildren();
    try {
      const response = await getInvoice(context, positiveId(field("invoice_id").value, "Invoice ID"));
      invoice = response.data;
      if (!["POSTED", "PARTIALLY_PAID", "PAID"].includes(invoice.invoice.status)) throw new Error("Only posted invoices can be returned.");
      if (invoice.invoice.currency_code !== "PKR") throw new Error("This return form supports PKR invoices only.");
      container.querySelector("#return-invoice-summary").innerHTML = `<p class="muted">Invoice ${escapeHtml(invoice.invoice.invoice_number)} · Customer #${escapeHtml(invoice.invoice.customer_id)} · ${money(invoice.invoice.grand_total)}</p>`;
      container.querySelector("#return-lines").innerHTML = invoice.lines.map((line) => `<div class="invoice-entry-line" data-invoice-item-id="${escapeHtml(line.id)}"><label><input type="checkbox" data-return-include> Product #${escapeHtml(line.product_id)} · ${escapeHtml(line.quantity)} ${escapeHtml(line.unit)} · ${money(line.unit_price)}</label><label>Return quantity<input name="quantity" type="number" min="0.000001" max="${escapeHtml(line.quantity)}" step="any" placeholder="Quantity"></label><label>Return warehouse<select name="warehouse_id"><option value="">Choose warehouse</option>${warehouses.map((warehouse) => option(warehouse.id, warehouse.name)).join("")}</select></label></div>`).join("");
      for (const row of container.querySelectorAll("#return-lines .invoice-entry-line")) row.querySelector('[name="warehouse_id"]').value = String(invoice.invoice.warehouse_id ?? "");
      message.hidden = true;
    } catch (error) { showError(error); }
  }

  form.addEventListener("input", resetReview);
  form.addEventListener("change", resetReview);
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); message.hidden = true;
    if (action.disabled) return;
    if (!pendingDraft) {
      try {
        if (!invoice || Number(field("invoice_id").value) !== Number(invoice.invoice.id)) throw new Error("Load the selected invoice before reviewing the return.");
        pendingDraft = validateReturnDraft({
          credit_note_number: field("credit_note_number").value, credit_date: field("credit_date").value,
          reason: field("reason").value, notes: field("notes").value,
          items: [...container.querySelectorAll("#return-lines .invoice-entry-line")].filter((row) => row.querySelector("[data-return-include]").checked).map((row) => ({ invoice_item_id: row.dataset.invoiceItemId, quantity: row.querySelector('[name="quantity"]').value, warehouse_id: row.querySelector('[name="warehouse_id"]').value })),
        }, invoice);
        const total = pendingDraft.items.reduce((sum, item) => sum + item.quantity * Number(invoice.lines.find((line) => line.id === item.invoice_item_id)?.unit_price ?? 0), 0);
        review.innerHTML = `<strong>Review before posting</strong><p>Credit note ${escapeHtml(pendingDraft.credit_note_number)} · ${pendingDraft.items.length} line(s) · estimated credit ${money(total)}.</p><p>Stock, customer receivables, and accounting will update when you post.</p>`;
        review.hidden = false; action.textContent = "Post Return"; pendingKey = globalThis.crypto.randomUUID();
      } catch (error) { showError(error); }
      return;
    }
    action.disabled = true;
    try {
      const response = await createReturn(context, pendingDraft, pendingKey);
      editor.close();
      await load();
      await openDetail(response.data.credit_note.id);
    } catch (error) { showError(error); }
    finally { action.disabled = false; }
  });

  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-open-workspace]")) globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace"));
    if (event.target.closest("[data-return-refresh]")) void load();
    if (event.target.closest("[data-return-next]") && nextCursor != null) void load(true);
    if (event.target.closest("[data-return-new]")) void openEditor();
    if (event.target.closest("[data-return-load-invoice]")) void loadInvoice();
    const row = event.target.closest("[data-return-id]");
    if (row) void openDetail(Number(row.dataset.returnId));
    if (event.target.closest("[data-return-close]")) detail.close();
    if (event.target.closest("[data-return-editor-close]")) editor.close();
  });
  search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => void load(), 250); });
  void load();
}

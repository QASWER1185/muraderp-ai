import { listCustomers } from "./customer-api.js";
import { icon } from "./icons.js";
import { createInvoice, createInvoiceFromEstimate, getInvoice, getReadyEstimate, listInvoices, listReadyEstimates } from "./invoice-api.js";
import { listProducts } from "./product-api.js";
import { listWarehouses } from "./warehouse-api.js";
import { getWorkspaceContext } from "./workspace-context.js";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const money = (value) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(Number(value) || 0);

export function invoiceErrorMessage(error) {
  if (error?.status === 401) return "Sign in to use Invoices.";
  if (error?.status === 403) return "You do not have permission to use Invoices in this workspace.";
  return error instanceof Error ? error.message : "Invoices could not be loaded.";
}

export function invoiceListMarkup(invoices) {
  if (!invoices.length) return `<div class="empty-state">${icon("receipt", 26)}<h2>No invoices yet</h2><p>Posted invoices for this branch will appear here.</p></div>`;
  return `<div class="invoice-list">${invoices.map((invoice) => `<button class="invoice-row" type="button" data-invoice-id="${escapeHtml(invoice.id)}"><span><strong>${escapeHtml(invoice.invoice_number)}</strong><small>${escapeHtml(invoice.issue_date)} · Customer #${escapeHtml(invoice.customer_id)}</small></span><span class="status-pill neutral">${escapeHtml(invoice.status)}</span><strong>${money(invoice.grand_total)}</strong>${icon("chevron")}</button>`).join("")}</div>`;
}

export function invoiceDetailMarkup({ invoice, lines }) {
  return `<div class="side-dialog-head"><div><p class="eyebrow">Posted Invoice</p><h2>${escapeHtml(invoice.invoice_number)}</h2></div><button class="icon-button" type="button" data-invoice-close aria-label="Close">${icon("close")}</button></div>
    <dl class="detail-list"><div><dt>Status</dt><dd>${escapeHtml(invoice.status)}</dd></div><div><dt>Date</dt><dd>${escapeHtml(invoice.issue_date)}</dd></div><div><dt>Customer</dt><dd>#${escapeHtml(invoice.customer_id)}</dd></div><div><dt>Warehouse</dt><dd>#${escapeHtml(invoice.warehouse_id)}</dd></div></dl>
    <h3>Lines</h3><div class="invoice-detail-lines">${lines.map((line) => `<div><span>Product #${escapeHtml(line.product_id)} · ${escapeHtml(line.quantity)} ${escapeHtml(line.unit)} × ${money(line.unit_price)}</span><strong>${money(line.line_total)}</strong></div>`).join("")}</div>
    <dl class="detail-list"><div><dt>Subtotal</dt><dd>${money(invoice.subtotal)}</dd></div><div><dt>Discount</dt><dd>${money(invoice.discount_total)}</dd></div><div><dt>Invoice total</dt><dd><strong>${money(invoice.grand_total)}</strong></dd></div><div><dt>Pass-through rent</dt><dd>${money(invoice.pass_through_rent)}</dd></div></dl>
    ${invoice.notes ? `<p class="muted">${escapeHtml(invoice.notes)}</p>` : ""}`;
}

export function validateInvoiceDraft(input) {
  const positiveId = (value, label) => { const number = Number(value); if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} is required.`); return number; };
  const amount = (value, label, positive = false) => { const number = Number(value); if (String(value ?? "").trim() === "" || !Number.isFinite(number) || number < 0 || (positive && number === 0)) throw new Error(`${label} must be ${positive ? "greater than zero" : "zero or greater"}.`); return number; };
  const lines = input.lines.map((line, index) => ({
    product_id: positiveId(line.product_id, `Product on line ${index + 1}`),
    quantity: amount(line.quantity, `Quantity on line ${index + 1}`, true),
    unit: String(line.unit ?? "").trim(),
    unit_price: amount(line.unit_price, `Sale rate on line ${index + 1}`),
    unit_cost: amount(line.unit_cost, `Explicit unit cost on line ${index + 1}`),
  }));
  if (!lines.length || lines.some((line) => !line.unit)) throw new Error("At least one complete invoice line is required.");
  const invoiceNumber = String(input.invoice_number ?? "").trim();
  if (!invoiceNumber || invoiceNumber.length > 100) throw new Error("A valid invoice number is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issue_date ?? "")) throw new Error("Invoice date is required.");
  const discount = amount(input.discount_total, "Discount");
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
  if (discount >= subtotal) throw new Error("Discount must be less than the invoice subtotal.");
  return {
    invoice_number: invoiceNumber, customer_id: positiveId(input.customer_id, "Customer"),
    warehouse_id: positiveId(input.warehouse_id, "Warehouse"), issue_date: input.issue_date,
    currency_code: "PKR", notes: String(input.notes ?? "").trim() || null,
    discount_total: discount, pass_through_rent: amount(input.pass_through_rent, "Pass-through rent"), lines,
  };
}

function option(id, label) { return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`; }
function lineMarkup(products, selectedProductId = null) {
  const fallback = selectedProductId && !products.some((product) => product.id === selectedProductId) ? option(selectedProductId, `Product #${selectedProductId}`) : "";
  return `<div class="invoice-entry-line"><label>Product<select name="product_id" required><option value="">Choose product</option>${fallback}${products.map((product) => option(product.id, `${product.name} · ${product.sku}`)).join("")}</select></label><label>Qty<input name="quantity" type="number" min="0.000001" step="any" value="1" required></label><label>Unit<input name="unit" required></label><label>Sale rate<input name="unit_price" type="number" min="0" step="any" required></label><label>Unit cost<input name="unit_cost" type="number" min="0" step="any" placeholder="Explicit cost" required></label><button class="icon-button" type="button" data-invoice-remove-line aria-label="Remove line">${icon("close")}</button></div>`;
}

export function mountInvoices(container, options = {}) {
  const context = options.context ?? getWorkspaceContext(options.storage ?? globalThis.sessionStorage);
  let invoices = [];
  let nextCursor = null;
  let products = [];
  let pendingKey = null;
  let pendingDraft = null;
  let sourceEstimate = null;
  container.innerHTML = `<section class="page-heading"><div><p class="eyebrow">Sales</p><h1>Invoices</h1><p class="page-intro">Posted invoices in your current workspace.</p></div><div class="invoice-heading-actions"><button class="button secondary" type="button" data-invoice-from-estimate>From ready estimate</button><button class="button primary" type="button" data-invoice-new>+ New Invoice</button></div></section><section class="surface"><div class="section-head"><h2>Invoice register</h2><button class="button secondary" type="button" data-invoice-refresh>Refresh</button></div><div id="invoice-results" aria-live="polite"></div><button class="button secondary" type="button" data-invoice-next hidden>Load more</button></section>
    <dialog id="invoice-detail" class="side-dialog"><div id="invoice-detail-content"></div></dialog>
    <dialog id="invoice-editor" class="invoice-dialog"><form id="invoice-form"><div class="side-dialog-head"><div><p class="eyebrow" id="invoice-editor-eyebrow">Direct sale</p><h2>New Invoice</h2></div><button class="icon-button" type="button" data-invoice-editor-close aria-label="Close">${icon("close")}</button></div><p class="muted">Posting an invoice updates stock, receivables, and accounting. Enter the explicit cost for every line.</p><div id="invoice-source-selector" hidden><label>Ready estimate<select name="source_estimate_id"></select></label><button class="button secondary" type="button" data-invoice-load-estimate>Load estimate</button></div><div class="invoice-entry-meta"><label>Invoice number<input name="invoice_number" maxlength="100" required></label><label>Date<input name="issue_date" type="date" required></label><label>Customer<select name="customer_id" required></select></label><label>Warehouse<select name="warehouse_id" required></select></label></div><div id="invoice-entry-lines"></div><button class="button secondary" type="button" data-invoice-add-line>+ Add line</button><div class="invoice-entry-meta"><label>Discount (PKR)<input name="discount_total" type="number" min="0" step="any" value="0" required></label><label>Pass-through rent (PKR)<input name="pass_through_rent" type="number" min="0" step="any" value="0" required></label></div><label>Notes<textarea name="notes" maxlength="2000"></textarea></label><p id="invoice-form-result" class="form-message" role="alert" hidden></p><div id="invoice-review" hidden></div><div class="dialog-actions"><button class="button secondary" type="button" data-invoice-editor-close>Cancel</button><button class="button primary" type="submit" id="invoice-action">Review Invoice</button></div></form></dialog>`;
  const results = container.querySelector("#invoice-results");
  const next = container.querySelector("[data-invoice-next]");
  const detail = container.querySelector("#invoice-detail");
  const editor = container.querySelector("#invoice-editor");
  const form = container.querySelector("#invoice-form");
  const message = container.querySelector("#invoice-form-result");
  const review = container.querySelector("#invoice-review");
  const action = container.querySelector("#invoice-action");
  const lineContainer = container.querySelector("#invoice-entry-lines");
  const field = (name) => form.elements.namedItem(name);
  const showError = (error) => { message.textContent = invoiceErrorMessage(error); message.hidden = false; };

  async function load(append = false) {
    if (!context) { results.innerHTML = `<div class="empty-state"><h2>Choose your workspace</h2><p>Choose an authorized business and branch to view invoices.</p><button class="button secondary" type="button" data-open-workspace>Choose workspace</button></div>`; return; }
    results.innerHTML = append ? results.innerHTML : `<div class="loading-state"><span class="spinner"></span>Loading invoices...</div>`;
    try {
      const page = await listInvoices(context, { cursor: append ? nextCursor : undefined });
      invoices = append ? [...invoices, ...page.data] : page.data;
      nextCursor = page.next_cursor;
      results.innerHTML = invoiceListMarkup(invoices);
      next.hidden = nextCursor == null;
    } catch (error) { results.innerHTML = `<div class="empty-state error-state"><h2>Invoices unavailable</h2><p>${escapeHtml(invoiceErrorMessage(error))}</p></div>`; }
  }

  async function openEditor(fromEstimate = false) {
    if (!context) { globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace")); return; }
    form.reset(); message.hidden = true; review.hidden = true; pendingDraft = null; pendingKey = null; sourceEstimate = null; action.textContent = "Review Invoice";
    container.querySelector("#invoice-source-selector").hidden = !fromEstimate;
    container.querySelector("#invoice-editor-eyebrow").textContent = fromEstimate ? "Ready estimate" : "Direct sale";
    container.querySelector("[data-invoice-add-line]").hidden = fromEstimate;
    field("customer_id").disabled = false;
    for (const name of ["discount_total", "pass_through_rent", "notes"]) field(name).disabled = false;
    lineContainer.replaceChildren();
    editor.showModal();
    try {
      const [customerPage, warehousePage, productPage] = await Promise.all([listCustomers(context, { limit: 100 }), listWarehouses(context, { limit: 100 }), listProducts(context, { limit: 100 })]);
      products = productPage.data ?? [];
      field("customer_id").innerHTML = `<option value="">Choose customer</option>${(customerPage.data ?? []).map((customer) => option(customer.id, customer.name)).join("")}`;
      field("warehouse_id").innerHTML = `<option value="">Choose warehouse</option>${(warehousePage.data ?? []).map((warehouse) => option(warehouse.id, warehouse.name)).join("")}`;
      if (fromEstimate) {
        const ready = await listReadyEstimates(context);
        field("source_estimate_id").innerHTML = `<option value="">Choose ready estimate</option>${(ready.data ?? []).map((item) => option(item.id, `${item.estimate_number} · Customer #${item.customer_id}`)).join("")}`;
        if (!(ready.data ?? []).length) throw new Error("No ready estimates are available in this branch.");
      } else lineContainer.insertAdjacentHTML("beforeend", lineMarkup(products));
      field("issue_date").value = new Date().toISOString().slice(0, 10);
      field("invoice_number").focus();
    } catch (error) { showError(error); }
  }

  async function loadSourceEstimate() {
    const sourceId = Number(field("source_estimate_id").value);
    if (!Number.isSafeInteger(sourceId) || sourceId <= 0) { showError(new Error("Choose a ready estimate.")); return; }
    try {
      const response = await getReadyEstimate(context, sourceId);
      sourceEstimate = response.data;
      if (sourceEstimate.currency_code !== "PKR") throw new Error("This Invoice form supports PKR estimates only.");
      pendingDraft = null; pendingKey = null; review.hidden = true; action.textContent = "Review Invoice";
      lineContainer.innerHTML = sourceEstimate.lines.map((line) => {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = lineMarkup(products, line.product_id);
        const row = wrapper.firstElementChild;
        row.dataset.lineNumber = String(line.line_number);
        for (const [name, value] of Object.entries({ product_id: line.product_id, quantity: line.quantity, unit: line.unit, unit_price: line.unit_price })) {
          row.querySelector(`[name="${name}"]`).value = value;
          row.querySelector(`[name="${name}"]`).disabled = true;
        }
        row.querySelector("[data-invoice-remove-line]").hidden = true;
        return row.outerHTML;
      }).join("");
      if (![...field("customer_id").options].some((entry) => Number(entry.value) === sourceEstimate.customer_id)) {
        field("customer_id").insertAdjacentHTML("beforeend", option(sourceEstimate.customer_id, `Customer #${sourceEstimate.customer_id}`));
      }
      field("customer_id").value = String(sourceEstimate.customer_id);
      field("customer_id").disabled = true;
      field("discount_total").value = String(sourceEstimate.lines.reduce((sum, line) => sum + line.discount_amount, 0));
      field("pass_through_rent").value = String(sourceEstimate.pass_through_rent);
      field("discount_total").disabled = true; field("pass_through_rent").disabled = true; field("notes").disabled = true;
      message.hidden = true;
    } catch (error) { showError(error); }
  }

  form.addEventListener("change", (event) => {
    if (event.target.name === "source_estimate_id") { sourceEstimate = null; pendingDraft = null; pendingKey = null; review.hidden = true; action.textContent = "Review Invoice"; lineContainer.replaceChildren(); return; }
    if (event.target.name !== "product_id") return;
    const product = products.find((item) => item.id === Number(event.target.value));
    const row = event.target.closest(".invoice-entry-line");
    if (product && row) { row.querySelector('[name="unit"]').value = product.unit; row.querySelector('[name="unit_price"]').value = product.sale_price; }
  });
  form.addEventListener("input", () => { if (pendingDraft) { pendingDraft = null; pendingKey = null; review.hidden = true; action.textContent = "Review Invoice"; } });
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); message.hidden = true;
    if (action.disabled) return;
    if (!pendingDraft) {
      try {
        if (container.querySelector("#invoice-source-selector").hidden === false) {
          if (!sourceEstimate) throw new Error("Load a ready estimate first.");
          const unit_costs = [...lineContainer.querySelectorAll(".invoice-entry-line")].map((row) => {
            const cost = row.querySelector('[name="unit_cost"]').value;
            if (cost.trim() === "" || !Number.isFinite(Number(cost)) || Number(cost) < 0) throw new Error("Enter an explicit unit cost for every estimate line.");
            return { line_number: Number(row.dataset.lineNumber), unit_cost: Number(cost) };
          });
          pendingDraft = { source_estimate_id: sourceEstimate.id, invoice_number: field("invoice_number").value.trim(), issue_date: field("issue_date").value, warehouse_id: Number(field("warehouse_id").value), unit_costs };
          if (!pendingDraft.invoice_number || !pendingDraft.issue_date || !pendingDraft.warehouse_id) throw new Error("Invoice number, date, and warehouse are required.");
        } else pendingDraft = validateInvoiceDraft({
          invoice_number: field("invoice_number").value, issue_date: field("issue_date").value,
          customer_id: field("customer_id").value, warehouse_id: field("warehouse_id").value,
          discount_total: field("discount_total").value, pass_through_rent: field("pass_through_rent").value,
          notes: field("notes").value,
          lines: [...lineContainer.querySelectorAll(".invoice-entry-line")].map((row) => Object.fromEntries(["product_id", "quantity", "unit", "unit_price", "unit_cost"].map((name) => [name, row.querySelector(`[name="${name}"]`).value]))),
        });
        const lines = sourceEstimate?.lines ?? pendingDraft.lines;
        const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
        const discount = sourceEstimate ? lines.reduce((sum, line) => sum + line.discount_amount, 0) : pendingDraft.discount_total;
        const rent = sourceEstimate ? sourceEstimate.pass_through_rent : pendingDraft.pass_through_rent;
        review.innerHTML = `<strong>Review before posting</strong><p>Invoice ${escapeHtml(pendingDraft.invoice_number)} · ${lines.length} line(s) · ${money(subtotal - discount)} invoice total · ${money(rent)} pass-through rent.</p><p>Stock, receivables, and accounting will update when you post.</p>`;
        review.hidden = false; action.textContent = "Post Invoice"; pendingKey = globalThis.crypto.randomUUID();
      } catch (error) { showError(error); }
      return;
    }
    action.disabled = true;
    try {
      const response = sourceEstimate ? await createInvoiceFromEstimate(context, pendingDraft, pendingKey) : await createInvoice(context, pendingDraft, pendingKey);
      editor.close();
      await load();
      await openDetail(response.data.invoice.id);
    } catch (error) { showError(error); }
    finally { action.disabled = false; }
  });

  async function openDetail(id) {
    detail.querySelector("#invoice-detail-content").innerHTML = `<div class="loading-state">Loading invoice...</div>`;
    if (!detail.open) detail.showModal();
    try { const response = await getInvoice(context, id); detail.querySelector("#invoice-detail-content").innerHTML = invoiceDetailMarkup(response.data); }
    catch (error) { detail.querySelector("#invoice-detail-content").innerHTML = `<div class="side-dialog-head"><h2>Invoice unavailable</h2><button class="icon-button" type="button" data-invoice-close aria-label="Close">${icon("close")}</button></div><p>${escapeHtml(invoiceErrorMessage(error))}</p>`; }
  }
  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-invoice-refresh]")) void load();
    if (event.target.closest("[data-invoice-next]")) void load(true);
    if (event.target.closest("[data-invoice-new]")) void openEditor();
    if (event.target.closest("[data-invoice-from-estimate]")) void openEditor(true);
    if (event.target.closest("[data-invoice-load-estimate]")) void loadSourceEstimate();
    if (event.target.closest("[data-invoice-close]")) detail.close();
    if (event.target.closest("[data-invoice-editor-close]")) editor.close();
    if (event.target.closest("[data-open-workspace]")) globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace"));
    if (event.target.closest("[data-invoice-add-line]")) { lineContainer.insertAdjacentHTML("beforeend", lineMarkup(products)); pendingDraft = null; pendingKey = null; review.hidden = true; action.textContent = "Review Invoice"; }
    if (event.target.closest("[data-invoice-remove-line]")) { if (lineContainer.children.length > 1) { event.target.closest(".invoice-entry-line").remove(); pendingDraft = null; pendingKey = null; review.hidden = true; action.textContent = "Review Invoice"; } }
    const row = event.target.closest("[data-invoice-id]");
    if (row) void openDetail(Number(row.dataset.invoiceId));
  });
  void load();
}

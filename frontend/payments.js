import { icon } from "./icons.js";
import { createCustomerPayment, getCustomerPayment, listCustomerPayments, listReceivables } from "./payment-api.js";
import { getWorkspaceContext } from "./workspace-context.js";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const money = (value, currency = "PKR") => new Intl.NumberFormat("en-PK", { style: "currency", currency }).format(Number(value) || 0);
const methods = { CASH: "Cash", BANK_TRANSFER: "Bank transfer", CARD: "Card", CHEQUE: "Cheque", OTHER: "Other" };

export function paymentErrorMessage(error) {
  if (error?.status === 401) return "Sign in to use Customer Payments.";
  if (error?.status === 403) return error?.code === "ALLOCATION_DENIED" ? error.message : "You do not have permission to use Customer Payments in this workspace.";
  return error instanceof Error ? error.message : "Customer Payments could not be loaded.";
}

export function validateCustomerPaymentDraft(input, receivable) {
  if (!receivable || Number(input.invoice_id) !== receivable.invoice_id) throw new Error("Choose an authorized invoice.");
  if (!(receivable.outstanding > 0)) throw new Error("The selected invoice has no outstanding balance.");
  const amountText = String(input.amount ?? "").trim();
  const amount = Number(amountText);
  if (!amountText || !Number.isFinite(amount) || amount <= 0) throw new Error("Payment amount must be greater than zero.");
  if (amount > receivable.outstanding) throw new Error("Payment amount exceeds the invoice outstanding balance.");
  const paymentDate = String(input.payment_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) throw new Error("Payment date is required.");
  const method = String(input.payment_method ?? "");
  if (!Object.hasOwn(methods, method)) throw new Error("Choose a payment method.");
  const reference = String(input.reference_number ?? "").trim();
  const notes = String(input.notes ?? "").trim();
  if (reference.length > 120) throw new Error("Reference must be 120 characters or fewer.");
  if (notes.length > 2000) throw new Error("Notes must be 2000 characters or fewer.");
  return {
    customer_id: receivable.customer_id, payment_date: paymentDate, amount,
    currency_code: receivable.currency_code, payment_method: method,
    allocations: [{ invoice_id: receivable.invoice_id, amount }],
    ...(reference ? { reference_number: reference } : {}),
    ...(notes ? { notes } : {}),
  };
}

export function receivableListMarkup(receivables) {
  if (!receivables.length) return `<div class="empty-state">${icon("receipt", 26)}<h2>No posted invoices</h2><p>Invoice balances for this branch will appear here.</p></div>`;
  return `<div class="invoice-list">${receivables.map((item) => `<div class="invoice-row"><span><strong>${escapeHtml(item.invoice_number)}</strong><small>${escapeHtml(item.customer_name)} · ${escapeHtml(item.status)}</small></span><span>Outstanding <strong>${money(item.outstanding, item.currency_code)}</strong></span></div>`).join("")}</div>`;
}

export function paymentListMarkup(payments) {
  if (!payments.length) return `<div class="empty-state">${icon("wallet", 26)}<h2>No customer payments yet</h2><p>Recorded payments for this branch will appear here.</p></div>`;
  return `<div class="invoice-list">${payments.map((payment) => `<button class="invoice-row" type="button" data-payment-id="${escapeHtml(payment.id)}"><span><strong>${escapeHtml(payment.reference_number || `Payment #${payment.id}`)}</strong><small>${escapeHtml(payment.payment_date)} · Customer #${escapeHtml(payment.customer_id)} · ${escapeHtml(methods[payment.payment_method] ?? payment.payment_method)}</small></span><strong>${money(payment.amount, payment.currency_code)}</strong>${icon("chevron")}</button>`).join("")}</div>`;
}

export function paymentDetailMarkup({ payment, allocations }) {
  return `<div class="side-dialog-head"><div><p class="eyebrow">Customer payment</p><h2>${escapeHtml(payment.reference_number || `Payment #${payment.id}`)}</h2></div><button class="icon-button" type="button" data-payment-close aria-label="Close">${icon("close")}</button></div>
    <dl class="detail-list"><div><dt>Customer</dt><dd>#${escapeHtml(payment.customer_id)}</dd></div><div><dt>Date</dt><dd>${escapeHtml(payment.payment_date)}</dd></div><div><dt>Method</dt><dd>${escapeHtml(methods[payment.payment_method] ?? payment.payment_method)}</dd></div><div><dt>Payment</dt><dd><strong>${money(payment.amount, payment.currency_code)}</strong></dd></div></dl>
    <h3>Invoice allocations</h3><div class="invoice-detail-lines">${allocations.map((allocation) => `<div><span>${escapeHtml(allocation.invoice_number)} · Invoice #${escapeHtml(allocation.invoice_id)}</span><strong>${money(allocation.amount, payment.currency_code)}</strong></div>`).join("")}</div>${payment.notes ? `<p class="muted">${escapeHtml(payment.notes)}</p>` : ""}`;
}

export function mountPayments(container, options = {}) {
  const context = options.context ?? getWorkspaceContext(options.storage ?? globalThis.sessionStorage);
  let receivables = [];
  let payments = [];
  let nextCursor = null;
  let pendingDraft = null;
  let pendingKey = null;
  container.innerHTML = `<section class="page-heading"><div><p class="eyebrow">Finance</p><h1>Customer Payments</h1><p class="page-intro">Apply customer payments to posted invoice balances in your current workspace.</p></div><button class="button primary" type="button" data-payment-new>+ New Customer Payment</button></section>
    <section class="surface"><div class="section-head"><h2>Invoice receivables</h2><button class="button secondary" type="button" data-payment-refresh>Refresh</button></div><div id="payment-receivables" aria-live="polite"></div></section>
    <section class="surface"><div class="section-head"><h2>Customer payment register</h2></div><div id="payment-results" aria-live="polite"></div><button class="button secondary" type="button" data-payment-next hidden>Load more</button></section>
    <dialog id="payment-detail" class="side-dialog"><div id="payment-detail-content"></div></dialog>
    <dialog id="payment-editor" class="invoice-dialog"><form id="payment-form"><div class="side-dialog-head"><div><p class="eyebrow">Customer receivable</p><h2>New Customer Payment</h2></div><button class="icon-button" type="button" data-payment-editor-close aria-label="Close">${icon("close")}</button></div><p class="muted">Posting allocates the payment to an invoice, updates the customer ledger, and records accounting through the existing payment service.</p>
      <label>Invoice<select name="invoice_id" required><option value="">Choose invoice</option></select></label><p id="payment-invoice-summary" class="muted"></p>
      <div class="invoice-entry-meta"><label>Payment date<input name="payment_date" type="date" required></label><label>Amount<input name="amount" type="number" min="0.000001" step="any" required></label><label>Payment method<select name="payment_method" required><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CARD">Card</option><option value="CHEQUE">Cheque</option><option value="OTHER">Other</option></select></label><label>Reference (optional)<input name="reference_number" maxlength="120"></label></div>
      <label>Notes<textarea name="notes" maxlength="2000"></textarea></label><p id="payment-form-result" class="form-message" role="alert" hidden></p><div id="payment-review" hidden></div><div class="dialog-actions"><button class="button secondary" type="button" data-payment-editor-close>Cancel</button><button class="button primary" type="submit" id="payment-action">Review Payment</button></div></form></dialog>`;
  const receivableResults = container.querySelector("#payment-receivables");
  const results = container.querySelector("#payment-results");
  const next = container.querySelector("[data-payment-next]");
  const detail = container.querySelector("#payment-detail");
  const editor = container.querySelector("#payment-editor");
  const form = container.querySelector("#payment-form");
  const message = container.querySelector("#payment-form-result");
  const review = container.querySelector("#payment-review");
  const action = container.querySelector("#payment-action");
  const field = (name) => form.elements.namedItem(name);
  const showError = (error) => { message.textContent = paymentErrorMessage(error); message.hidden = false; };
  const resetReview = () => { pendingDraft = null; pendingKey = null; review.hidden = true; action.textContent = "Review Payment"; };

  async function load(append = false) {
    if (!context) {
      receivableResults.innerHTML = `<div class="empty-state"><h2>Choose your workspace</h2><p>Choose an authorized business and branch to view customer payments.</p><button class="button secondary" type="button" data-open-workspace>Choose workspace</button></div>`;
      results.replaceChildren();
      return;
    }
    if (!append) {
      receivableResults.innerHTML = `<div class="loading-state">Loading invoice balances...</div>`;
      results.innerHTML = `<div class="loading-state">Loading customer payments...</div>`;
    }
    try {
      const [invoicePage, paymentPage] = await Promise.all([
        listReceivables(context), listCustomerPayments(context, { cursor: append ? nextCursor : undefined }),
      ]);
      receivables = invoicePage.data ?? [];
      payments = append ? [...payments, ...(paymentPage.data ?? [])] : paymentPage.data ?? [];
      nextCursor = paymentPage.next_cursor;
      receivableResults.innerHTML = receivableListMarkup(receivables);
      results.innerHTML = paymentListMarkup(payments);
      next.hidden = nextCursor == null;
    } catch (error) {
      const markup = `<div class="empty-state error-state"><h2>Customer Payments unavailable</h2><p>${escapeHtml(paymentErrorMessage(error))}</p></div>`;
      receivableResults.innerHTML = markup;
      results.replaceChildren();
    }
  }

  async function openDetail(id) {
    detail.querySelector("#payment-detail-content").innerHTML = `<div class="loading-state">Loading payment...</div>`;
    if (!detail.open) detail.showModal();
    try {
      const response = await getCustomerPayment(context, id);
      detail.querySelector("#payment-detail-content").innerHTML = paymentDetailMarkup(response.data);
    } catch (error) {
      detail.querySelector("#payment-detail-content").innerHTML = `<div class="side-dialog-head"><h2>Payment unavailable</h2><button class="icon-button" type="button" data-payment-close aria-label="Close">${icon("close")}</button></div><p>${escapeHtml(paymentErrorMessage(error))}</p>`;
    }
  }

  async function openEditor() {
    if (!context) { globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace")); return; }
    form.reset(); resetReview(); message.hidden = true;
    field("payment_date").value = new Date().toISOString().slice(0, 10);
    container.querySelector("#payment-invoice-summary").textContent = "Loading authorized invoice balances...";
    editor.showModal();
    try {
      const page = await listReceivables(context);
      receivables = page.data ?? [];
      const open = receivables.filter((item) => item.outstanding > 0);
      field("invoice_id").innerHTML = `<option value="">Choose invoice</option>${open.map((item) => `<option value="${escapeHtml(item.invoice_id)}">${escapeHtml(item.invoice_number)} · ${escapeHtml(item.customer_name)} · ${money(item.outstanding, item.currency_code)} outstanding</option>`).join("")}`;
      container.querySelector("#payment-invoice-summary").textContent = open.length ? "Choose the posted invoice to settle." : "No outstanding invoices are available in this branch.";
      field("invoice_id").focus();
    } catch (error) { showError(error); }
  }

  form.addEventListener("input", resetReview);
  form.addEventListener("change", (event) => {
    resetReview();
    if (event.target.name !== "invoice_id") return;
    const selected = receivables.find((item) => item.invoice_id === Number(field("invoice_id").value));
    container.querySelector("#payment-invoice-summary").textContent = selected
      ? `${selected.customer_name} · ${selected.invoice_number} · ${money(selected.outstanding, selected.currency_code)} outstanding`
      : "Choose the posted invoice to settle.";
    field("amount").value = selected ? String(selected.outstanding) : "";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); message.hidden = true;
    if (action.disabled) return;
    if (!pendingDraft) {
      try {
        const selected = receivables.find((item) => item.invoice_id === Number(field("invoice_id").value));
        pendingDraft = validateCustomerPaymentDraft({
          invoice_id: field("invoice_id").value, payment_date: field("payment_date").value,
          amount: field("amount").value, payment_method: field("payment_method").value,
          reference_number: field("reference_number").value, notes: field("notes").value,
        }, selected);
        review.innerHTML = `<strong>Review before posting</strong><p>${escapeHtml(selected.customer_name)} · ${escapeHtml(selected.invoice_number)} · ${money(pendingDraft.amount, pendingDraft.currency_code)} via ${escapeHtml(methods[pendingDraft.payment_method])}.</p><p>The invoice balance, customer ledger, and accounting will update when you post.</p>`;
        review.hidden = false; action.textContent = "Post Customer Payment"; pendingKey = globalThis.crypto.randomUUID();
      } catch (error) { showError(error); }
      return;
    }
    action.disabled = true;
    try {
      const response = await createCustomerPayment(context, pendingDraft, pendingKey);
      editor.close();
      await load();
      await openDetail(response.data.payment.id);
    } catch (error) { showError(error); }
    finally { action.disabled = false; }
  });

  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-open-workspace]")) globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace"));
    if (event.target.closest("[data-payment-refresh]")) void load();
    if (event.target.closest("[data-payment-next]") && nextCursor != null) void load(true);
    if (event.target.closest("[data-payment-new]")) void openEditor();
    if (event.target.closest("[data-payment-close]")) detail.close();
    if (event.target.closest("[data-payment-editor-close]")) editor.close();
    const row = event.target.closest("[data-payment-id]");
    if (row) void openDetail(Number(row.dataset.paymentId));
  });
  void load();
}

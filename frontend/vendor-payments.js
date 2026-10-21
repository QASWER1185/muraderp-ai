import { icon } from "./icons.js";
import { createVendorPayment, getVendorPayment, listVendorPayables, listVendorPayments } from "./vendor-payment-api.js";
import { getWorkspaceContext } from "./workspace-context.js";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const money = (value) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(Number(value) || 0);
const methods = { CASH: "Cash", BANK: "Bank", OTHER: "Other" };
const purchaseLabel = (item) => item.invoice_number || `Purchase #${item.purchase_id}`;

export function vendorPaymentErrorMessage(error) {
  if (error?.status === 401) return "Sign in to use Vendor Payments.";
  if (error?.status === 403) return error?.code === "ALLOCATION_DENIED" ? error.message : "You do not have permission to use Vendor Payments in this workspace.";
  return error instanceof Error ? error.message : "Vendor Payments could not be loaded.";
}

export function validateVendorPaymentDraft(input, payable) {
  if (!payable || Number(input.purchase_id) !== payable.purchase_id || Number(input.vendor_id) !== payable.vendor_id) {
    throw new Error("Choose an authorized vendor and purchase.");
  }
  if (!(payable.outstanding > 0)) throw new Error("The selected purchase has no outstanding balance.");
  const amountText = String(input.amount ?? "").trim();
  const amount = Number(amountText);
  if (!amountText || !Number.isFinite(amount) || amount <= 0) throw new Error("Payment amount must be greater than zero.");
  if (amount > payable.outstanding) throw new Error("Payment amount exceeds the purchase outstanding balance.");
  const paymentDate = String(input.payment_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) throw new Error("Payment date is required.");
  const method = String(input.payment_method ?? "");
  if (!Object.hasOwn(methods, method)) throw new Error("Choose a payment method.");
  const reference = String(input.reference ?? "").trim();
  const notes = String(input.notes ?? "").trim();
  if (reference.length > 120) throw new Error("Reference must be 120 characters or fewer.");
  if (notes.length > 2000) throw new Error("Notes must be 2000 characters or fewer.");
  return {
    vendor_id: payable.vendor_id, payment_date: paymentDate, amount,
    payment_method: method, allocations: [{ purchase_id: payable.purchase_id, amount }],
    ...(reference ? { reference } : {}),
    ...(notes ? { notes } : {}),
  };
}

export function payableListMarkup(payables) {
  if (!payables.length) return `<div class="empty-state">${icon("receipt", 26)}<h2>No purchase payables</h2><p>Purchases for this branch will appear here.</p></div>`;
  return `<div class="invoice-list">${payables.map((item) => `<div class="invoice-row"><span><strong>${escapeHtml(purchaseLabel(item))}</strong><small>${escapeHtml(item.vendor_name)} · ${escapeHtml(item.purchase_date)}</small></span><span>Outstanding <strong>${money(item.outstanding)}</strong></span></div>`).join("")}</div>`;
}

export function vendorPaymentListMarkup(payments) {
  if (!payments.length) return `<div class="empty-state">${icon("wallet", 26)}<h2>No vendor payments yet</h2><p>Posted payments for this branch will appear here.</p></div>`;
  return `<div class="invoice-list">${payments.map((payment) => `<button class="invoice-row" type="button" data-vendor-payment-id="${escapeHtml(payment.id)}"><span><strong>${escapeHtml(payment.reference || `Payment #${payment.id}`)}</strong><small>${escapeHtml(payment.payment_date)} · ${escapeHtml(payment.vendor_name)} · ${escapeHtml(methods[payment.payment_method] ?? payment.payment_method)}</small></span><strong>${money(payment.amount)}</strong>${icon("chevron")}</button>`).join("")}</div>`;
}

export function vendorPaymentDetailMarkup({ payment, allocations }) {
  return `<div class="side-dialog-head"><div><p class="eyebrow">Vendor payment</p><h2>${escapeHtml(payment.reference || `Payment #${payment.id}`)}</h2></div><button class="icon-button" type="button" data-vendor-payment-close aria-label="Close">${icon("close")}</button></div>
    <dl class="detail-list"><div><dt>Vendor</dt><dd>${escapeHtml(payment.vendor_name)}</dd></div><div><dt>Date</dt><dd>${escapeHtml(payment.payment_date)}</dd></div><div><dt>Method</dt><dd>${escapeHtml(methods[payment.payment_method] ?? payment.payment_method)}</dd></div><div><dt>Status</dt><dd>${escapeHtml(payment.status)}</dd></div><div><dt>Payment</dt><dd><strong>${money(payment.amount)}</strong></dd></div></dl>
    <h3>Purchase allocations</h3><div class="invoice-detail-lines">${allocations.map((allocation) => `<div><span>${escapeHtml(allocation.purchase_reference)} · Purchase #${escapeHtml(allocation.purchase_id)}</span><strong>${money(allocation.amount)}</strong></div>`).join("")}</div>${payment.notes ? `<p class="muted">${escapeHtml(payment.notes)}</p>` : ""}`;
}

export function mountVendorPayments(container, options = {}) {
  const context = options.context ?? getWorkspaceContext(options.storage ?? globalThis.sessionStorage);
  let payables = [];
  let payments = [];
  let nextCursor = null;
  let pendingDraft = null;
  let pendingKey = null;
  container.innerHTML = `<section class="page-heading"><div><p class="eyebrow">Purchasing</p><h1>Vendor Payments</h1><p class="page-intro">Settle purchase payables in your current workspace.</p></div><button class="button primary" type="button" data-vendor-payment-new>+ New Vendor Payment</button></section>
    <section class="surface"><div class="section-head"><h2>Vendor payables</h2><button class="button secondary" type="button" data-vendor-payment-refresh>Refresh</button></div><div id="vendor-payment-payables" aria-live="polite"></div></section>
    <section class="surface"><div class="section-head"><h2>Vendor payment register</h2></div><div id="vendor-payment-results" aria-live="polite"></div><button class="button secondary" type="button" data-vendor-payment-next hidden>Load more</button></section>
    <dialog id="vendor-payment-detail" class="side-dialog"><div id="vendor-payment-detail-content"></div></dialog>
    <dialog id="vendor-payment-editor" class="invoice-dialog"><form id="vendor-payment-form"><div class="side-dialog-head"><div><p class="eyebrow">Vendor payable</p><h2>New Vendor Payment</h2></div><button class="icon-button" type="button" data-vendor-payment-editor-close aria-label="Close">${icon("close")}</button></div><p class="muted">Posting allocates the payment to a purchase and updates the vendor ledger and accounting through the existing payment service.</p>
      <label>Vendor<select name="vendor_id" required><option value="">Choose vendor</option></select></label>
      <label>Purchase<select name="purchase_id" required><option value="">Choose purchase</option></select></label><p id="vendor-payment-balance" class="muted"></p>
      <div class="invoice-entry-meta"><label>Payment date<input name="payment_date" type="date" required></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Payment method<select name="payment_method" required><option value="CASH">Cash</option><option value="BANK">Bank</option><option value="OTHER">Other</option></select></label><label>Reference (optional)<input name="reference" maxlength="120"></label></div>
      <label>Notes<textarea name="notes" maxlength="2000"></textarea></label><p id="vendor-payment-form-result" class="form-message" role="alert" hidden></p><div id="vendor-payment-review" hidden></div><div class="dialog-actions"><button class="button secondary" type="button" data-vendor-payment-editor-close>Cancel</button><button class="button primary" type="submit" id="vendor-payment-action">Review Payment</button></div></form></dialog>`;
  const payableResults = container.querySelector("#vendor-payment-payables");
  const results = container.querySelector("#vendor-payment-results");
  const next = container.querySelector("[data-vendor-payment-next]");
  const detail = container.querySelector("#vendor-payment-detail");
  const editor = container.querySelector("#vendor-payment-editor");
  const form = container.querySelector("#vendor-payment-form");
  const message = container.querySelector("#vendor-payment-form-result");
  const review = container.querySelector("#vendor-payment-review");
  const action = container.querySelector("#vendor-payment-action");
  const field = (name) => form.elements.namedItem(name);
  const showError = (error) => { message.textContent = vendorPaymentErrorMessage(error); message.hidden = false; };
  const resetReview = () => { pendingDraft = null; pendingKey = null; review.hidden = true; action.textContent = "Review Payment"; };

  async function allPayables() {
    const rows = [];
    let cursor;
    do {
      const page = await listVendorPayables(context, { cursor });
      rows.push(...(page.data ?? []));
      cursor = page.next_cursor;
    } while (cursor != null);
    return rows;
  }

  async function load(append = false) {
    if (!context) {
      payableResults.innerHTML = `<div class="empty-state"><h2>Choose your workspace</h2><p>Choose an authorized business and branch to view vendor payments.</p><button class="button secondary" type="button" data-open-workspace>Choose workspace</button></div>`;
      results.replaceChildren();
      return;
    }
    if (!append) {
      payableResults.innerHTML = `<div class="loading-state">Loading purchase balances...</div>`;
      results.innerHTML = `<div class="loading-state">Loading vendor payments...</div>`;
    }
    try {
      const [payableRows, paymentPage] = await Promise.all([
        allPayables(), listVendorPayments(context, { cursor: append ? nextCursor : undefined }),
      ]);
      payables = payableRows;
      payments = append ? [...payments, ...(paymentPage.data ?? [])] : paymentPage.data ?? [];
      nextCursor = paymentPage.next_cursor;
      payableResults.innerHTML = payableListMarkup(payables);
      results.innerHTML = vendorPaymentListMarkup(payments);
      next.hidden = nextCursor == null;
    } catch (error) {
      payableResults.innerHTML = `<div class="empty-state error-state"><h2>Vendor Payments unavailable</h2><p>${escapeHtml(vendorPaymentErrorMessage(error))}</p></div>`;
      results.replaceChildren();
    }
  }

  async function openDetail(id) {
    detail.querySelector("#vendor-payment-detail-content").innerHTML = `<div class="loading-state">Loading payment...</div>`;
    if (!detail.open) detail.showModal();
    try {
      const response = await getVendorPayment(context, id);
      detail.querySelector("#vendor-payment-detail-content").innerHTML = vendorPaymentDetailMarkup(response.data);
    } catch (error) {
      detail.querySelector("#vendor-payment-detail-content").innerHTML = `<div class="side-dialog-head"><h2>Payment unavailable</h2><button class="icon-button" type="button" data-vendor-payment-close aria-label="Close">${icon("close")}</button></div><p>${escapeHtml(vendorPaymentErrorMessage(error))}</p>`;
    }
  }

  function updatePurchaseOptions() {
    const vendorId = Number(field("vendor_id").value);
    const open = payables.filter((item) => item.vendor_id === vendorId && item.outstanding > 0);
    field("purchase_id").innerHTML = `<option value="">Choose purchase</option>${open.map((item) => `<option value="${escapeHtml(item.purchase_id)}">${escapeHtml(purchaseLabel(item))} · ${money(item.outstanding)} outstanding</option>`).join("")}`;
    const vendorTotal = open.reduce((sum, item) => sum + item.outstanding, 0);
    container.querySelector("#vendor-payment-balance").textContent = vendorId
      ? `${money(vendorTotal)} outstanding across ${open.length} purchase${open.length === 1 ? "" : "s"}.`
      : "Choose a vendor to view its outstanding purchases.";
    field("amount").value = "";
  }

  async function openEditor() {
    if (!context) { globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace")); return; }
    form.reset(); resetReview(); message.hidden = true;
    field("payment_date").value = new Date().toISOString().slice(0, 10);
    container.querySelector("#vendor-payment-balance").textContent = "Loading authorized purchase balances...";
    editor.showModal();
    try {
      payables = await allPayables();
      const open = payables.filter((item) => item.outstanding > 0);
      const vendors = [...new Map(open.map((item) => [item.vendor_id, item.vendor_name])).entries()];
      field("vendor_id").innerHTML = `<option value="">Choose vendor</option>${vendors.map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("")}`;
      updatePurchaseOptions();
      if (!open.length) container.querySelector("#vendor-payment-balance").textContent = "No outstanding purchases are available in this branch.";
      field("vendor_id").focus();
    } catch (error) { showError(error); }
  }

  form.addEventListener("input", resetReview);
  form.addEventListener("change", (event) => {
    resetReview();
    if (event.target.name === "vendor_id") updatePurchaseOptions();
    if (event.target.name === "purchase_id") {
      const item = payables.find((row) => row.purchase_id === Number(field("purchase_id").value) && row.vendor_id === Number(field("vendor_id").value));
      if (item) {
        container.querySelector("#vendor-payment-balance").textContent = `${item.vendor_name} · ${purchaseLabel(item)} · ${money(item.outstanding)} outstanding`;
        field("amount").value = String(item.outstanding);
      }
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); message.hidden = true;
    if (action.disabled) return;
    if (!pendingDraft) {
      try {
        const selected = payables.find((item) => item.purchase_id === Number(field("purchase_id").value) && item.vendor_id === Number(field("vendor_id").value));
        pendingDraft = validateVendorPaymentDraft({
          vendor_id: field("vendor_id").value, purchase_id: field("purchase_id").value,
          payment_date: field("payment_date").value, amount: field("amount").value,
          payment_method: field("payment_method").value, reference: field("reference").value, notes: field("notes").value,
        }, selected);
        review.innerHTML = `<strong>Review before posting</strong><p>${escapeHtml(selected.vendor_name)} · ${escapeHtml(purchaseLabel(selected))} · ${money(pendingDraft.amount)} via ${escapeHtml(methods[pendingDraft.payment_method])}.</p><p>Payable: ${money(selected.outstanding)} → ${money(selected.outstanding - pendingDraft.amount)}. The vendor ledger and accounting will update when you post.</p>`;
        review.hidden = false; action.textContent = "Post Vendor Payment"; pendingKey = globalThis.crypto.randomUUID();
      } catch (error) { showError(error); }
      return;
    }
    action.disabled = true;
    try {
      const response = await createVendorPayment(context, pendingDraft, pendingKey);
      editor.close();
      await load();
      await openDetail(response.data.payment_id);
    } catch (error) { showError(error); }
    finally { action.disabled = false; }
  });

  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-open-workspace]")) globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace"));
    if (event.target.closest("[data-vendor-payment-refresh]")) void load();
    if (event.target.closest("[data-vendor-payment-next]") && nextCursor != null) void load(true);
    if (event.target.closest("[data-vendor-payment-new]")) void openEditor();
    if (event.target.closest("[data-vendor-payment-close]")) detail.close();
    if (event.target.closest("[data-vendor-payment-editor-close]")) editor.close();
    const row = event.target.closest("[data-vendor-payment-id]");
    if (row) void openDetail(Number(row.dataset.vendorPaymentId));
  });
  void load();
}

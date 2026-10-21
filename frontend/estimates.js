import { createCustomer, listCustomers } from "./customer-api.js";
import { createEstimateDraft } from "./estimate-api.js";
import { listEstimateRateLists, prepareEstimateWhatsAppShare, previewEstimateRateList } from "./estimate-conversion.js";
import { createEstimatePdfFile, downloadEstimatePdf, shareEstimatePdf } from "./estimate-pdf.js";
import { icon } from "./icons.js";
import { queueJsonRequest } from "./offline-sync.js";
import { listProducts } from "./product-api.js";
import { getWorkspaceContext } from "./workspace-context.js";

const DRAFT_KEY = "muraderp.estimate-draft";
const DRAFT_VERSION = 2;
const STANDARD_RATE_LIST = "Store Standard Rates";
const STORE = {
  name: "MURAD BUILDING MATERIALS STORE",
  categories: "Cement, Bricks, Sand, Electric, Sanitary, All Other Building Materials",
  phone: "0308 6235608",
  address: "Al Kabir Town, Raiwind Road, Lahore.",
};

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 2 }).format(number(value));
}

function percentage(value) {
  return new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(number(value));
}

function lineKey() {
  return globalThis.crypto?.randomUUID?.() ?? `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createEstimateLine(overrides = {}) {
  return { key: lineKey(), productId: null, productLabel: "", quantity: 1, unit: "unit", rate: 0, rateListId: null, ...overrides };
}

export function isStartedEstimateLine(line) {
  return line?.productId != null || String(line?.productLabel ?? "").trim() !== "" || number(line?.quantity) !== 1 || String(line?.unit ?? "unit") !== "unit" || number(line?.rate) !== 0;
}

export function isCompleteEstimateLine(line) {
  return Number.isInteger(Number(line?.productId)) && Number(line.productId) > 0 && number(line.quantity) > 0 && String(line.unit ?? "").trim() !== "" && number(line.rate) >= 0;
}

export function normalizeEstimateLines(lines, makeLine = createEstimateLine) {
  const source = Array.isArray(lines) ? lines : [];
  const started = source.filter(isStartedEstimateLine);
  const existingTrailing = source.findLast?.((line) => !isStartedEstimateLine(line)) ?? [...source].reverse().find((line) => !isStartedEstimateLine(line));
  if (!started.length) return [existingTrailing ?? makeLine()];
  if (!isCompleteEstimateLine(started.at(-1))) return started;
  return [...started, existingTrailing ?? makeLine()];
}

export function meaningfulEstimateLines(lines) {
  return (Array.isArray(lines) ? lines : []).filter(isStartedEstimateLine);
}

export function applyReviewedRateChanges(lines, reviewedLines, targetRateListId) {
  const started = meaningfulEstimateLines(lines);
  if (!Array.isArray(reviewedLines) || reviewedLines.length !== started.length || reviewedLines.some((review, index) => review.status !== "MATCHED" || number(review.product_id) !== number(started[index].productId) || number(review.new_rate) < 0)) {
    throw new Error("Only a complete, safely matched rate review can be applied.");
  }
  const rates = new Map(started.map((line, index) => [line.key, reviewedLines[index]]));
  return lines.map((line) => {
    const reviewed = rates.get(line.key);
    return reviewed ? { ...line, rate: number(reviewed.new_rate), rateListId: Number(targetRateListId) } : line;
  });
}

function defaultNumber() {
  const date = new Date();
  const day = date.toLocaleDateString("en-CA").replaceAll("-", "");
  const time = `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
  return `EST-${day}-${time}`;
}

export function calculateDraftTotals(lines, overallDiscount = 0, carriageDelivery = 0) {
  const subtotal = meaningfulEstimateLines(lines).reduce((sum, line) => sum + number(line.quantity) * number(line.rate), 0);
  const discountPercent = Math.min(100, Math.max(0, number(overallDiscount)));
  const discountAmount = subtotal * discountPercent / 100;
  const amountAfterDiscount = subtotal - discountAmount;
  const carriage = number(carriageDelivery);
  return { subtotal, discountPercent, discountAmount, amountAfterDiscount, discount: discountAmount, carriageDelivery: carriage, grandTotal: Math.max(0, amountAfterDiscount + carriage) };
}

export function validateEstimateDraft(draft) {
  if (!String(draft.customerName ?? "").trim()) throw new Error("Customer name is required.");
  if (!String(draft.phone ?? "").trim()) throw new Error("Phone number is required.");
  if (!String(draft.address ?? "").trim()) throw new Error("Customer address is required.");
  if (!String(draft.estimateNumber ?? "").trim()) throw new Error("Estimate number is required.");
  if (!draft.issueDate || Number.isNaN(Date.parse(draft.issueDate))) throw new Error("Estimate date is required.");
  const draftLines = meaningfulEstimateLines(draft.lines);
  if (!draftLines.length) throw new Error("Add at least one item.");
  const lines = draftLines.map((line, index) => {
    const productId = Number(line.productId);
    const quantity = number(line.quantity);
    const unitPrice = number(line.rate);
    if (!Number.isInteger(productId) || productId <= 0) throw new Error(`Select a product on line ${index + 1}.`);
    if (quantity <= 0) throw new Error(`Quantity must be greater than zero on line ${index + 1}.`);
    if (!String(line.unit ?? "").trim()) throw new Error(`Selected product pricing details are incomplete on line ${index + 1}.`);
    if (unitPrice < 0) throw new Error(`Rate cannot be negative on line ${index + 1}.`);
    return { product_id: productId, quantity, unit: String(line.unit).trim(), unit_price: unitPrice };
  });
  const discountPercent = draft.overallDiscount == null ? 0 : Number(draft.overallDiscount);
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) throw new Error("Discount percentage must be between 0 and 100.");
  const totals = calculateDraftTotals(draftLines, discountPercent, draft.carriageDelivery);
  if (totals.carriageDelivery < 0) throw new Error("Carriage / Delivery cannot be negative.");
  return {
    customer_id: draft.customerId == null ? null : Number(draft.customerId),
    estimate_number: String(draft.estimateNumber).trim(),
    issue_date: draft.issueDate,
    currency_code: "PKR",
    notes: String(draft.notes ?? "").trim() || null,
    overall_discount: totals.discountAmount,
    carriage_delivery: totals.carriageDelivery,
    default_rate_list_id: draft.rateListId == null ? null : Number(draft.rateListId),
    lines,
  };
}

function lineMarkup(line, index) {
  const total = number(line.quantity) * number(line.rate);
  const trailing = !isStartedEstimateLine(line);
  return `<tr data-line-key="${escapeHtml(line.key)}" class="${trailing ? "estimate-entry-row" : ""}">
    <td class="estimate-line-number">${index + 1}</td>
    <td class="estimate-product-cell"><label><span>Item</span><input name="product" value="${escapeHtml(line.productLabel)}" list="estimate-products" placeholder="Search product or SKU" autocomplete="off" /></label>${trailing ? '<small class="next-row-hint">Next item ready</small>' : ""}</td>
    <td><label><span>Quantity</span><input name="quantity" type="number" min="0.001" step="any" value="${escapeHtml(line.quantity)}" inputmode="decimal" /></label></td>
    <td><label><span>Rate</span><input name="rate" type="number" min="0" step="any" value="${escapeHtml(line.rate)}" inputmode="decimal" /></label></td>
    <td class="estimate-line-total"><span>Total</span><strong>${money(total)}</strong></td>
    <td><button class="icon-button remove-line" type="button" data-remove-line aria-label="Remove item ${index + 1}">${icon("trash", 16)}</button></td>
  </tr>`;
}

export function previewableEstimateDraft(state) {
  return { ...state, lines: meaningfulEstimateLines(state.lines) };
}

export function estimatePreviewMarkup(draft) {
  const totals = calculateDraftTotals(draft.lines, draft.overallDiscount, draft.carriageDelivery);
  const displayDate = new Date(`${draft.issueDate}T00:00:00`).toLocaleDateString("en-PK", { dateStyle: "long" });
  return `<article class="estimate-document">
    <header class="estimate-document-header"><div class="estimate-logo">M</div><div><h2><span>M</span> ${STORE.name}</h2><p>${STORE.categories}</p><div><span>${STORE.phone}</span><span>${STORE.address}</span></div></div><aside><strong>ESTIMATE</strong><span>${escapeHtml(draft.estimateNumber)}</span><small>${displayDate}</small></aside></header>
    <section class="estimate-document-customer"><div><small>ESTIMATE FOR</small><strong>${escapeHtml(draft.customerName)}</strong><span>${escapeHtml(draft.phone)}</span><span>${escapeHtml(draft.address)}</span></div><div><small>RATE LIST / COMPANY</small><strong>${escapeHtml(draft.rateListName || STANDARD_RATE_LIST)}</strong><span>Rates subject to confirmation</span><span>Prepared in PKR</span></div></section>
    <table><thead><tr><th>#</th><th>Item</th><th>Quantity</th><th>Rate</th><th>Total</th></tr></thead><tbody>${draft.lines.map((line, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(line.productLabel)}</strong></td><td>${number(line.quantity).toLocaleString("en-PK")}</td><td>${money(line.rate)}</td><td><strong>${money(number(line.quantity) * number(line.rate))}</strong></td></tr>`).join("")}</tbody></table>
    <footer><div><small>NOTES</small><p>${escapeHtml(draft.notes || "Thank you for choosing Murad Building Materials Store.")}</p><span>Authorized Signature</span></div><dl><div><dt>Subtotal</dt><dd>${money(totals.subtotal)}</dd></div><div><dt>Discount (${percentage(totals.discountPercent)}%)</dt><dd>− ${money(totals.discountAmount)}</dd></div><div><dt>Amount After Discount</dt><dd>${money(totals.amountAfterDiscount)}</dd></div><div><dt>Carriage / Delivery</dt><dd>${money(totals.carriageDelivery)}</dd></div><div class="document-grand-total"><dt>Grand Total</dt><dd>${money(totals.grandTotal)}</dd></div></dl></footer>
  </article>`;
}

export function estimatePageMarkup() {
  return `<div class="estimate-page"><section class="estimate-page-heading"><div><p class="eyebrow">Sales document</p><h1>Create Estimate</h1><p>Prepare a clear, professional estimate for your customer.</p></div><div><button class="button secondary" type="button" data-estimate-preview>${icon("eye", 17)} Preview</button><button class="button primary" type="button" data-estimate-save>Save Estimate</button></div></section>
  <div id="estimate-workspace-notice" class="estimate-notice" role="status"><span class="spinner"></span><span>Loading customers, products, and rate lists...</span></div>
  <section class="estimate-editor surface">
    <div class="estimate-brand-header"><div class="estimate-logo">M</div><div class="estimate-brand-identity"><p class="eyebrow">Official Estimate</p><h2><span>M</span> ${STORE.name}</h2><p>${STORE.categories}</p><div class="business-contact"><span>${icon("phone", 14)} ${STORE.phone}</span><span>${icon("location", 14)} ${STORE.address}</span></div></div><div class="estimate-rate-context"><small>Rate List / Company</small><strong id="estimate-rate-list-name">${STANDARD_RATE_LIST}</strong><button class="button secondary compact" type="button" data-change-rate-list>${icon("refresh", 14)} Change Rate List</button></div><div class="estimate-meta"><label>Estimate No.<input id="estimate-number" value="${defaultNumber()}" maxlength="100" /></label><label>Date<input id="estimate-date" type="date" value="${new Date().toLocaleDateString("en-CA")}" /></label></div></div>

    <section class="estimate-section"><div class="estimate-section-heading"><div><span>01</span><div><h3>Customer Details</h3><p>Select an existing customer or enter a new one.</p></div></div></div><div class="customer-entry-grid"><label class="customer-picker">Existing customer<select id="estimate-customer"><option value="">New / walk-in customer</option></select></label><label>Customer Name<input id="estimate-customer-name" autocomplete="name" placeholder="Customer name" /></label><label>Phone Number<input id="estimate-phone" autocomplete="tel" placeholder="03XX XXXXXXX" /></label><label>Address<input id="estimate-address" autocomplete="street-address" placeholder="Customer address" /></label></div></section>

    <section class="estimate-section estimate-items-section"><div class="estimate-section-heading"><div><span>02</span><div><h3>Estimate Items</h3><p>Select a product and the next entry row appears automatically.</p></div></div><button class="button secondary compact" type="button" data-add-line>${icon("plus", 15)} Add Item</button></div>
      <datalist id="estimate-products"></datalist><div class="estimate-table-wrap"><table class="estimate-entry-table"><thead><tr><th>#</th><th>Item</th><th>Quantity</th><th>Rate</th><th>Total</th><th>Action</th></tr></thead><tbody id="estimate-lines"></tbody></table></div><button class="add-line-wide" type="button" data-add-line>${icon("plus", 16)} Add another item</button>
    </section>

    <section class="estimate-footer-grid"><label>Notes<textarea id="estimate-notes" rows="4" placeholder="Payment terms, delivery details, or a note for the customer"></textarea></label><aside class="estimate-totals"><div><span>Subtotal</span><strong id="estimate-subtotal">${money(0)}</strong></div><label class="total-input discount-percent-input"><span>Discount</span><span class="percentage-field"><input id="estimate-overall-discount" type="number" min="0" max="100" step="any" value="0" inputmode="decimal" aria-label="Estimate discount percentage" /><b aria-hidden="true">%</b></span></label><div><span>Discount Amount</span><strong id="estimate-discount-amount">− ${money(0)}</strong></div><div class="amount-after-discount"><span>Amount After Discount</span><strong id="estimate-after-discount">${money(0)}</strong></div><label class="total-input"><span>Carriage / Delivery</span><input id="estimate-carriage" type="number" min="0" step="any" value="0" inputmode="decimal" /></label><div class="grand-total"><span>Grand Total</span><strong id="estimate-grand-total">${money(0)}</strong></div><small>Final totals are validated by the server when saved.</small></aside></section>
    <p id="estimate-message" class="estimate-message" role="status" aria-live="polite" hidden></p>
    <div class="estimate-actions"><span><span class="draft-dot"></span> Draft saves locally as you work</span><div><button class="button secondary" type="button" data-estimate-preview>${icon("eye", 17)} Preview</button><button class="button whatsapp-button" type="button" data-estimate-whatsapp disabled>${icon("send", 16)} Share on WhatsApp</button><button class="button primary" type="button" data-estimate-save>Save Estimate</button></div></div>
  </section>

  <dialog id="estimate-rate-list-dialog" class="estimate-business-dialog"><form method="dialog" class="estimate-dialog-card" data-rate-list-form><header><div><p class="eyebrow">Pricing</p><h2>Change Rate List</h2><p>Choose an authorized company rate list for this Estimate.</p></div><button class="icon-button" value="cancel" aria-label="Close">${icon("close")}</button></header><div class="current-rate-list"><span>Current Rate List</span><strong data-current-rate-list>${STANDARD_RATE_LIST}</strong></div><div id="estimate-rate-list-options" class="rate-list-options"><span class="spinner"></span><span>Loading authorized rate lists...</span></div><p id="estimate-rate-list-message" class="dialog-message" role="status" hidden></p><footer><button class="button secondary" value="cancel">Cancel</button><button class="button primary" type="submit" data-review-rates>Review New Rates</button></footer></form></dialog>

  <dialog id="estimate-rate-review-dialog" class="estimate-business-dialog rate-review-dialog"><div class="estimate-dialog-card"><header><div><p class="eyebrow">Rate matching review</p><h2>Review New Rates</h2><p><span data-review-current>${STANDARD_RATE_LIST}</span> <span aria-hidden="true">→</span> <strong data-review-target></strong></p></div><button class="icon-button" type="button" data-rate-review-close aria-label="Close">${icon("close")}</button></header><div id="estimate-rate-review-summary" class="rate-review-summary"></div><div id="estimate-rate-review-table" class="rate-review-table-wrap"></div><footer><button class="button secondary" type="button" data-back-to-rate-lists>Back</button><button class="button primary" type="button" data-apply-rates>Apply New Rates</button></footer></div></dialog>

  <dialog id="estimate-preview" class="estimate-preview-dialog"><div class="preview-toolbar"><div><p class="eyebrow">Customer preview</p><strong>Estimate document</strong></div><div><button class="button secondary" type="button" data-estimate-pdf>Download PDF</button><button class="button secondary" type="button" data-estimate-print>${icon("printer", 16)} Print</button><button class="icon-button" type="button" data-estimate-preview-close aria-label="Close">${icon("close")}</button></div></div><div id="estimate-preview-content"></div></dialog></div>`;
}

export function estimateRateReviewMarkup(result, sourceLines) {
  return `<table><thead><tr><th>Item</th><th>Quantity</th><th>Old Rate</th><th>New Rate</th><th>Total</th><th>Status</th></tr></thead><tbody>${result.lines.map((review, index) => {
    const line = sourceLines[index];
    const matched = review.status === "MATCHED";
    const total = matched ? number(line.quantity) * number(review.new_rate) : null;
    return `<tr class="${matched ? "matched" : "needs-review"}"><td><strong>${escapeHtml(line.productLabel)}</strong>${review.message ? `<small>${escapeHtml(review.message)}</small>` : ""}</td><td>${number(line.quantity).toLocaleString("en-PK")}</td><td>${money(review.old_rate)}</td><td>${matched ? money(review.new_rate) : "—"}</td><td>${total == null ? "—" : money(total)}</td><td><span class="match-status ${matched ? "success" : "warning"}">${matched ? "Matched" : "Needs review"}</span></td></tr>`;
  }).join("")}</tbody></table>`;
}

export function mountEstimates(container, options = {}) {
  container.innerHTML = estimatePageMarkup();
  const root = container.querySelector(".estimate-page");
  const storage = options.storage ?? globalThis.sessionStorage;
  const context = options.context ?? getWorkspaceContext(storage);
  const state = {
    customers: [], products: [], rateLists: [], customerId: null, customerName: "", phone: "", address: "",
    estimateNumber: container.querySelector("#estimate-number").value,
    issueDate: container.querySelector("#estimate-date").value,
    notes: "", overallDiscount: 0, carriageDelivery: 0, rateListId: null, rateListName: STANDARD_RATE_LIST,
    lines: [createEstimateLine()], idempotencyKey: null, savedEstimateId: null, pendingRatePreview: null,
  };
  const linesBody = container.querySelector("#estimate-lines");
  const customerSelect = container.querySelector("#estimate-customer");
  const customerName = container.querySelector("#estimate-customer-name");
  const phone = container.querySelector("#estimate-phone");
  const address = container.querySelector("#estimate-address");
  const notice = container.querySelector("#estimate-workspace-notice");
  const message = container.querySelector("#estimate-message");
  const previewDialog = container.querySelector("#estimate-preview");
  const previewContent = container.querySelector("#estimate-preview-content");
  const rateListDialog = container.querySelector("#estimate-rate-list-dialog");
  const rateReviewDialog = container.querySelector("#estimate-rate-review-dialog");
  const discountInput = container.querySelector("#estimate-overall-discount");
  const carriageInput = container.querySelector("#estimate-carriage");

  function productLabel(product) { return `${product.name} — ${product.sku}`; }
  function selectedProduct(value) {
    const term = String(value ?? "").trim().toLowerCase();
    return state.products.find((item) => productLabel(item).toLowerCase() === term || item.name.toLowerCase() === term || item.sku.toLowerCase() === term);
  }
  function draftSnapshot() {
    return {
      customerId: state.customerId, customerName: state.customerName, phone: state.phone, address: state.address,
      estimateNumber: state.estimateNumber, issueDate: state.issueDate, notes: state.notes,
      overallDiscount: state.overallDiscount, carriageDelivery: state.carriageDelivery,
      rateListId: state.rateListId, rateListName: state.rateListName, lines: state.lines,
    };
  }
  function saveLocal() {
    try { storage?.setItem(DRAFT_KEY, JSON.stringify({ version: DRAFT_VERSION, context, draft: draftSnapshot() })); } catch { /* Session draft storage is optional. */ }
  }
  function updateShareAvailability() {
    container.querySelector("[data-estimate-whatsapp]").disabled = state.savedEstimateId == null;
  }
  function invalidateSave() { state.idempotencyKey = null; state.savedEstimateId = null; updateShareAvailability(); saveLocal(); }
  function renderTotals() {
    const totals = calculateDraftTotals(state.lines, state.overallDiscount, state.carriageDelivery);
    container.querySelector("#estimate-subtotal").textContent = money(totals.subtotal);
    container.querySelector("#estimate-discount-amount").textContent = `− ${money(totals.discountAmount)}`;
    container.querySelector("#estimate-after-discount").textContent = money(totals.amountAfterDiscount);
    container.querySelector("#estimate-grand-total").textContent = money(totals.grandTotal);
  }
  function renderRateContext() {
    container.querySelector("#estimate-rate-list-name").textContent = state.rateListName || STANDARD_RATE_LIST;
    container.querySelector("[data-current-rate-list]").textContent = state.rateListName || STANDARD_RATE_LIST;
  }
  function renderLines({ focusKey = null, focusField = "product" } = {}) {
    linesBody.innerHTML = state.lines.map(lineMarkup).join("");
    renderTotals();
    if (focusKey) linesBody.querySelector(`tr[data-line-key="${CSS.escape(focusKey)}"] input[name="${focusField}"]`)?.focus();
  }
  function showMessage(text, tone = "neutral") {
    message.hidden = false; message.className = `estimate-message ${tone}`; message.textContent = text;
  }
  function syncDraftFields() {
    state.customerName = customerName.value; state.phone = phone.value; state.address = address.value;
    state.estimateNumber = container.querySelector("#estimate-number").value;
    state.issueDate = container.querySelector("#estimate-date").value;
    state.notes = container.querySelector("#estimate-notes").value;
    state.overallDiscount = number(discountInput.value);
    discountInput.setCustomValidity(state.overallDiscount < 0 || state.overallDiscount > 100 ? "Enter a discount percentage between 0 and 100." : "");
    state.carriageDelivery = number(carriageInput.value);
  }
  function restoreDraft() {
    try {
      const saved = JSON.parse(storage?.getItem(DRAFT_KEY) ?? "null");
      if (!saved?.draft || JSON.stringify(saved.context) !== JSON.stringify(context)) return;
      const restoredDraft = { ...saved.draft };
      if (saved.version !== DRAFT_VERSION) {
        const legacyLineDiscount = Array.isArray(restoredDraft.lines) ? restoredDraft.lines.reduce((sum, line) => sum + number(line.discount), 0) : 0;
        const legacyDiscountAmount = number(restoredDraft.overallDiscount) + legacyLineDiscount;
        const legacySubtotal = meaningfulEstimateLines(restoredDraft.lines).reduce((sum, line) => sum + number(line.quantity) * number(line.rate), 0);
        restoredDraft.overallDiscount = legacySubtotal > 0 ? Math.min(100, legacyDiscountAmount / legacySubtotal * 100) : 0;
      }
      Object.assign(state, restoredDraft, { overallDiscount: number(restoredDraft.overallDiscount), idempotencyKey: null, savedEstimateId: null, pendingRatePreview: null });
      state.lines = normalizeEstimateLines((state.lines ?? []).map((line) => ({ ...line, key: line.key || lineKey(), rateListId: line.rateListId ?? state.rateListId ?? null })));
      customerName.value = state.customerName; phone.value = state.phone; address.value = state.address;
      container.querySelector("#estimate-number").value = state.estimateNumber;
      container.querySelector("#estimate-date").value = state.issueDate;
      container.querySelector("#estimate-notes").value = state.notes;
      discountInput.value = String(state.overallDiscount);
      carriageInput.value = String(state.carriageDelivery);
    } catch { /* Ignore an invalid optional draft. */ }
  }

  async function loadRateLists() {
    if (!context) return [];
    const result = await (options.listRateLists ?? listEstimateRateLists)(context, { customerId: state.customerId, currencyCode: "PKR" });
    state.rateLists = result ?? [];
    return state.rateLists;
  }

  async function loadLookups() {
    if (!context) {
      notice.className = "estimate-notice warning";
      notice.innerHTML = `${icon("alert", 18)}<span><strong>Workspace needed</strong> Choose your business workspace to load customers, products, and rate lists.</span><button class="button secondary compact" type="button" data-open-workspace>Choose workspace</button>`;
      return;
    }
    const [customerResult, productResult, rateListResult] = await Promise.allSettled([
      (options.listCustomers ?? listCustomers)(context, { limit: 100 }),
      (options.listProducts ?? listProducts)(context, { limit: 100 }),
      loadRateLists(),
    ]);
    if (customerResult.status === "fulfilled") {
      state.customers = customerResult.value.data ?? [];
      customerSelect.innerHTML = `<option value="">New / walk-in customer</option>${state.customers.map((customer) => `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)} · ${escapeHtml(customer.phone)}</option>`).join("")}`;
      if (state.customerId != null) customerSelect.value = String(state.customerId);
    }
    if (productResult.status === "fulfilled") {
      state.products = productResult.value.data ?? [];
      container.querySelector("#estimate-products").innerHTML = state.products.map((product) => `<option value="${escapeHtml(productLabel(product))}"></option>`).join("");
    }
    if (customerResult.status === "fulfilled" && productResult.status === "fulfilled" && rateListResult.status === "fulfilled") {
      notice.className = "estimate-notice ready";
      notice.innerHTML = `${icon("check", 18)}<span><strong>Ready</strong> Customers, products, and authorized rate lists are available.</span>`;
    } else {
      notice.className = "estimate-notice warning";
      notice.innerHTML = `${icon("alert", 18)}<span><strong>Some records are unavailable.</strong> Estimate drafting remains available with records already loaded or restored.</span>`;
    }
  }

  function openPreview() {
    syncDraftFields();
    previewContent.innerHTML = estimatePreviewMarkup(previewableEstimateDraft(state));
    previewDialog.showModal();
  }

  function makePdf() {
    syncDraftFields();
    const draft = previewableEstimateDraft(state);
    return createEstimatePdfFile(draft, calculateDraftTotals(draft.lines, draft.overallDiscount, draft.carriageDelivery));
  }

  async function saveEstimate() {
    syncDraftFields();
    let payload;
    try { payload = validateEstimateDraft(state); }
    catch (error) { showMessage(error instanceof Error ? error.message : "Complete the estimate before saving.", "error"); return; }
    if (!context) { showMessage("Choose your business workspace before saving this estimate.", "error"); globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace")); return; }
    const buttons = container.querySelectorAll("[data-estimate-save]"); buttons.forEach((button) => { button.disabled = true; });
    showMessage("Validating and saving the estimate...", "neutral");
    try {
      if (payload.customer_id == null) {
        if (!navigator.onLine) throw new Error("A new customer must be saved while online. Your estimate draft remains available locally.");
        const customerResponse = await (options.createCustomer ?? createCustomer)(context, { name: state.customerName.trim(), phone: state.phone.trim(), city: state.address.trim() });
        state.customerId = customerResponse.data.id; payload.customer_id = customerResponse.data.id;
        state.customers.push(customerResponse.data);
        customerSelect.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(state.customerId)}">${escapeHtml(state.customerName)} · ${escapeHtml(state.phone)}</option>`);
        customerSelect.value = String(state.customerId);
      }
      state.idempotencyKey ??= `estimate-browser-${crypto.randomUUID()}`;
      if (!navigator.onLine) {
        await (options.queueRequest ?? queueJsonRequest)({
          endpoint: "/api/v1/estimates", method: "POST", kind: "estimate-create",
          headers: { "X-Organization-Id": context.organizationId, "X-Branch-Id": context.branchId, "Idempotency-Key": state.idempotencyKey }, body: payload,
        });
        showMessage("You are offline. This estimate is safely queued and will sync when the connection returns. WhatsApp sharing becomes available after it syncs.", "success");
        saveLocal(); return;
      }
      const response = await (options.createEstimate ?? createEstimateDraft)(context, payload, state.idempotencyKey);
      state.savedEstimateId = response.data.id;
      updateShareAvailability();
      showMessage(`Estimate ${response.data.definition?.estimate_number ?? state.estimateNumber} saved successfully. You can now share its PDF on WhatsApp.`, "success");
      storage?.removeItem(DRAFT_KEY);
    } catch (error) {
      const text = error?.status === 401 ? "Sign in before saving this estimate." : error?.status === 403 ? "You do not have permission to create estimates in this workspace." : error?.status === 404 ? "Estimate creation is not connected to this frontend deployment." : error instanceof Error ? error.message : "The estimate could not be saved.";
      showMessage(text, "error");
    } finally { buttons.forEach((button) => { button.disabled = false; }); }
  }

  function renderRateListOptions() {
    const optionsRoot = container.querySelector("#estimate-rate-list-options");
    const choices = state.rateLists.filter((rateList) => Number(rateList.id) !== Number(state.rateListId));
    if (!choices.length) {
      optionsRoot.innerHTML = `<div class="rate-list-empty">${icon("alert", 18)}<span>No other authorized rate lists are available for this customer.</span></div>`;
      container.querySelector("[data-review-rates]").disabled = true;
      return;
    }
    optionsRoot.innerHTML = choices.map((rateList, index) => `<label class="rate-list-choice"><input type="radio" name="target-rate-list" value="${escapeHtml(rateList.id)}" ${index === 0 ? "checked" : ""}/><span><strong>${escapeHtml(rateList.name)}</strong><small>${escapeHtml(rateList.code)}</small></span><span class="choice-check">${icon("check", 15)}</span></label>`).join("");
    container.querySelector("[data-review-rates]").disabled = false;
  }

  async function openRateListDialog() {
    if (!context) { showMessage("Choose your business workspace before changing the rate list.", "error"); globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace")); return; }
    const optionsRoot = container.querySelector("#estimate-rate-list-options");
    optionsRoot.innerHTML = '<span class="spinner"></span><span>Loading authorized rate lists...</span>';
    container.querySelector("#estimate-rate-list-message").hidden = true;
    renderRateContext();
    rateListDialog.showModal();
    try { await loadRateLists(); renderRateListOptions(); }
    catch (error) {
      optionsRoot.innerHTML = "";
      const dialogMessage = container.querySelector("#estimate-rate-list-message");
      dialogMessage.hidden = false; dialogMessage.textContent = error instanceof Error ? error.message : "Rate lists could not be loaded.";
      container.querySelector("[data-review-rates]").disabled = true;
    }
  }

  async function previewRateChange(event) {
    event.preventDefault();
    const selected = rateListDialog.querySelector('input[name="target-rate-list"]:checked');
    if (!selected) return;
    const target = state.rateLists.find((rateList) => String(rateList.id) === selected.value);
    if (!target) return;
    syncDraftFields();
    const sourceLines = meaningfulEstimateLines(state.lines);
    if (!sourceLines.length) {
      state.rateListId = target.id; state.rateListName = target.name;
      renderRateContext(); rateListDialog.close(); invalidateSave();
      showMessage(`${target.name} selected. New items will use this rate list.`, "success");
      return;
    }
    try { sourceLines.forEach((line, index) => { if (!isCompleteEstimateLine(line)) throw new Error(`Complete item ${index + 1} before changing the rate list.`); }); }
    catch (error) { const dialogMessage = container.querySelector("#estimate-rate-list-message"); dialogMessage.hidden = false; dialogMessage.textContent = error.message; return; }
    const reviewButton = container.querySelector("[data-review-rates]");
    reviewButton.disabled = true; reviewButton.textContent = "Matching products...";
    try {
      const result = await (options.previewRateList ?? previewEstimateRateList)(context, {
        customer_id: state.customerId, target_rate_list_id: Number(target.id), pricing_date: state.issueDate, currency_code: "PKR",
        lines: sourceLines.map((line) => ({ product_id: Number(line.productId), quantity: number(line.quantity), unit: String(line.unit).trim(), current_unit_price: number(line.rate) })),
      });
      state.pendingRatePreview = { result, sourceKeys: sourceLines.map((line) => line.key), currentName: state.rateListName, target };
      container.querySelector("[data-review-current]").textContent = state.rateListName;
      container.querySelector("[data-review-target]").textContent = target.name;
      const summary = container.querySelector("#estimate-rate-review-summary");
      summary.className = `rate-review-summary ${result.can_apply ? "success" : "warning"}`;
      summary.innerHTML = result.can_apply ? `${icon("check", 19)}<div><strong>All items matched successfully</strong><span>${result.matched} ${result.matched === 1 ? "item" : "items"} ready for the new rates.</span></div>` : `${icon("alert", 19)}<div><strong>${result.matched} matched · ${result.needs_review} need review</strong><span>Unmatched items will not be substituted or changed.</span></div>`;
      container.querySelector("#estimate-rate-review-table").innerHTML = estimateRateReviewMarkup(result, sourceLines);
      container.querySelector("[data-apply-rates]").disabled = !result.can_apply;
      rateListDialog.close(); rateReviewDialog.showModal();
    } catch (error) {
      const dialogMessage = container.querySelector("#estimate-rate-list-message");
      dialogMessage.hidden = false; dialogMessage.textContent = error instanceof Error ? error.message : "The rate-list preview could not be prepared.";
    } finally { reviewButton.disabled = false; reviewButton.textContent = "Review New Rates"; }
  }

  function applyReviewedRates() {
    const pending = state.pendingRatePreview;
    if (!pending?.result?.can_apply) return;
    const currentKeys = meaningfulEstimateLines(state.lines).map((line) => line.key);
    if (JSON.stringify(currentKeys) !== JSON.stringify(pending.sourceKeys)) return;
    try { state.lines = applyReviewedRateChanges(state.lines, pending.result.lines, pending.target.id); }
    catch { return; }
    state.rateListId = Number(pending.target.id); state.rateListName = pending.target.name; state.pendingRatePreview = null;
    renderRateContext(); renderLines(); rateReviewDialog.close(); invalidateSave();
    showMessage(`${state.rateListName} rates applied. Items, quantities, order, and Estimate discount were preserved.`, "success");
  }

  async function refreshLineRate(line) {
    if (!context || state.rateListId == null || !isCompleteEstimateLine(line)) return;
    const productId = Number(line.productId); const quantity = number(line.quantity); const unit = String(line.unit).trim(); const rateListId = Number(state.rateListId);
    try {
      const result = await (options.previewRateList ?? previewEstimateRateList)(context, { customer_id: state.customerId, target_rate_list_id: rateListId, pricing_date: state.issueDate, currency_code: "PKR", lines: [{ product_id: productId, quantity, unit, current_unit_price: number(line.rate) }] });
      const reviewed = result.lines?.[0];
      if (Number(line.productId) !== productId || number(line.quantity) !== quantity || String(line.unit).trim() !== unit || Number(state.rateListId) !== rateListId) return;
      if (reviewed?.status !== "MATCHED") { showMessage(`${line.productLabel} needs review in ${state.rateListName}; its existing rate was kept.`, "error"); return; }
      line.rate = number(reviewed.new_rate); line.rateListId = rateListId;
      const row = linesBody.querySelector(`tr[data-line-key="${CSS.escape(line.key)}"]`);
      if (row) { row.querySelector('input[name="rate"]').value = String(line.rate); row.querySelector(".estimate-line-total strong").textContent = money(number(line.quantity) * line.rate); }
      renderTotals(); invalidateSave();
    } catch (error) { showMessage(error instanceof Error ? error.message : "The selected rate could not be checked.", "error"); }
  }

  function applySelectedProduct(line, product) {
    line.productId = product.id; line.productLabel = productLabel(product); line.unit = product.unit; line.rate = number(product.sale_price); line.rateListId = null;
    state.lines = normalizeEstimateLines(state.lines);
    renderLines({ focusKey: line.key, focusField: "quantity" }); invalidateSave();
    void refreshLineRate(line);
  }

  async function shareOnWhatsApp() {
    if (state.savedEstimateId == null) { showMessage("Save this Estimate before sharing it on WhatsApp.", "error"); return; }
    const shareButton = container.querySelector("[data-estimate-whatsapp]");
    shareButton.disabled = true; showMessage("Preparing the customer PDF for WhatsApp...", "neutral");
    try {
      const file = makePdf();
      const totals = calculateDraftTotals(state.lines, state.overallDiscount, state.carriageDelivery);
      let shareText = `${STORE.name}\nEstimate ${state.estimateNumber}\nGrand Total: ${money(totals.grandTotal)}`;
      if (context && navigator.onLine) {
        try {
          const delivery = await (options.prepareWhatsAppShare ?? prepareEstimateWhatsAppShare)({ ...context, estimateId: state.savedEstimateId });
          if (delivery?.message) shareText = delivery.message;
        } catch { /* The local PDF and user-controlled share sheet remain available. */ }
      }
      const mode = await (options.sharePdf ?? shareEstimatePdf)({ file, title: `Estimate ${state.estimateNumber}`, text: shareText });
      showMessage(mode === "PDF_SHARED" ? "The Estimate PDF was sent to the share sheet. Choose WhatsApp, select the customer, and press Send." : "The Estimate PDF was downloaded and the share flow opened. Attach the downloaded PDF, select the customer, and press Send.", "success");
    } catch (error) { if (error?.name !== "AbortError") showMessage(error instanceof Error ? error.message : "WhatsApp sharing is unavailable in this browser.", "error"); }
    finally { shareButton.disabled = state.savedEstimateId == null; }
  }

  restoreDraft(); state.lines = normalizeEstimateLines(state.lines); renderRateContext(); renderLines(); updateShareAvailability();
  [customerName, phone, address].forEach((field) => field.addEventListener("input", () => {
    if (state.customerId != null) { state.customerId = null; customerSelect.value = ""; }
    syncDraftFields(); invalidateSave();
  }));
  [container.querySelector("#estimate-number"), container.querySelector("#estimate-date"), container.querySelector("#estimate-notes"), discountInput, carriageInput].forEach((field) => field.addEventListener("input", () => { syncDraftFields(); renderTotals(); invalidateSave(); }));
  customerSelect.addEventListener("change", () => {
    const customer = state.customers.find((item) => String(item.id) === customerSelect.value);
    state.customerId = customer?.id ?? null;
    if (customer) { customerName.value = customer.name; phone.value = customer.phone; address.value = customer.city; }
    else { customerName.value = ""; phone.value = ""; address.value = ""; customerName.focus(); }
    syncDraftFields(); invalidateSave(); void loadRateLists().catch(() => {});
  });
  linesBody.addEventListener("input", (event) => {
    const row = event.target.closest("tr[data-line-key]"); if (!row) return;
    const line = state.lines.find((item) => item.key === row.dataset.lineKey); if (!line) return;
    const field = event.target.name;
    if (["quantity", "rate"].includes(field)) line[field] = number(event.target.value);
    if (field === "product") {
      line.productLabel = event.target.value; line.productId = null; line.rateListId = null;
      const product = selectedProduct(event.target.value);
      if (product) { applySelectedProduct(line, product); return; }
    }
    if (field === "rate") line.rateListId = null;
    row.querySelector(".estimate-line-total strong").textContent = money(number(line.quantity) * number(line.rate));
    renderTotals(); invalidateSave();
  });
  linesBody.addEventListener("change", (event) => {
    const row = event.target.closest("tr[data-line-key]");
    const line = state.lines.find((item) => item.key === row?.dataset.lineKey); if (!line) return;
    if (event.target.name === "product") {
      const product = selectedProduct(event.target.value);
      if (!product) { line.productId = null; showMessage("Choose a product from the authorized product list.", "error"); return; }
      applySelectedProduct(line, product);
      return;
    }
    if (["quantity", "rate"].includes(event.target.name)) {
      const previousLength = state.lines.length;
      state.lines = normalizeEstimateLines(state.lines);
      if (state.lines.length !== previousLength) renderLines({ focusKey: line.key, focusField: event.target.name });
      if (event.target.name === "quantity") void refreshLineRate(line);
    }
  });
  linesBody.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const row = event.target.closest("tr[data-line-key]");
    if (!row) return;
    const fields = ["product", "quantity", "rate"];
    const index = fields.indexOf(event.target.name);
    if (index < 0) return;
    event.preventDefault();
    if (index < fields.length - 1) row.querySelector(`input[name="${fields[index + 1]}"]`)?.focus();
    else {
      const lineIndex = state.lines.findIndex((line) => line.key === row.dataset.lineKey);
      state.lines = normalizeEstimateLines(state.lines);
      const nextLine = state.lines[lineIndex + 1];
      if (nextLine && !row.nextElementSibling) renderLines({ focusKey: nextLine.key });
      else row.nextElementSibling?.querySelector('input[name="product"]')?.focus();
    }
  });
  linesBody.addEventListener("click", (event) => {
    if (!event.target.closest("[data-remove-line]")) return;
    const row = event.target.closest("tr[data-line-key]");
    state.lines = normalizeEstimateLines(state.lines.filter((line) => line.key !== row.dataset.lineKey));
    renderLines(); invalidateSave();
  });
  container.querySelectorAll("[data-add-line]").forEach((button) => button.addEventListener("click", () => {
    const trailing = state.lines.findLast?.((line) => !isStartedEstimateLine(line)) ?? [...state.lines].reverse().find((line) => !isStartedEstimateLine(line));
    if (trailing) { renderLines({ focusKey: trailing.key }); return; }
    const line = createEstimateLine(); state.lines.push(line); renderLines({ focusKey: line.key }); invalidateSave();
  }));
  container.querySelectorAll("[data-estimate-preview]").forEach((button) => button.addEventListener("click", openPreview));
  container.querySelectorAll("[data-estimate-save]").forEach((button) => button.addEventListener("click", () => void saveEstimate()));
  container.querySelector("[data-estimate-whatsapp]").addEventListener("click", () => void shareOnWhatsApp());
  container.querySelector("[data-change-rate-list]").addEventListener("click", () => void openRateListDialog());
  container.querySelector("[data-rate-list-form]").addEventListener("submit", (event) => void previewRateChange(event));
  container.querySelector("[data-apply-rates]").addEventListener("click", applyReviewedRates);
  container.querySelector("[data-rate-review-close]").addEventListener("click", () => { state.pendingRatePreview = null; rateReviewDialog.close(); });
  container.querySelector("[data-back-to-rate-lists]").addEventListener("click", () => { rateReviewDialog.close(); rateListDialog.showModal(); });
  container.querySelector("[data-estimate-preview-close]").addEventListener("click", () => previewDialog.close());
  container.querySelector("[data-estimate-print]").addEventListener("click", () => window.print());
  container.querySelector("[data-estimate-pdf]").addEventListener("click", () => {
    try { downloadEstimatePdf(makePdf()); showMessage("The customer-facing Estimate PDF was downloaded.", "success"); }
    catch (error) { showMessage(error instanceof Error ? error.message : "The PDF could not be prepared.", "error"); }
  });
  root.addEventListener("click", (event) => { if (event.target.closest("[data-open-workspace]")) globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace")); });
  void loadLookups();
}

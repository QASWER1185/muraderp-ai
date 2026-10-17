import { icon } from "./icons.js";
import { listProducts } from "./product-api.js";
import { createPurchase, getPurchase, listPurchases } from "./purchase-api.js";
import { listVendors } from "./vendor-api.js";
import { listWarehouses } from "./warehouse-api.js";
import { getWorkspaceContext } from "./workspace-context.js";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const money = (value) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(Number(value) || 0);
const positiveId = (value, label) => { const number = Number(value); if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} is required.`); return number; };

export function purchaseErrorMessage(error) {
  if (error?.status === 401) return "Sign in to use Purchases.";
  if (error?.status === 403) return "You do not have permission to use Purchases in this workspace.";
  return error instanceof Error ? error.message : "Purchases could not be loaded.";
}

export function purchaseListMarkup(purchases) {
  if (!purchases.length) return `<div class="empty-state">${icon("cart", 26)}<h2>No purchases yet</h2><p>Posted purchases for this branch will appear here.</p></div>`;
  return `<div class="invoice-list">${purchases.map((purchase) => `<button class="invoice-row" type="button" data-purchase-id="${escapeHtml(purchase.id)}"><span><strong>${escapeHtml(purchase.invoice_number || `Purchase #${purchase.id}`)}</strong><small>${escapeHtml(purchase.purchase_date)} · Vendor #${escapeHtml(purchase.vendor_id)}</small></span><strong>${money(purchase.total)}</strong>${icon("chevron")}</button>`).join("")}</div>`;
}

export function purchaseDetailMarkup({ purchase, items }) {
  return `<div class="side-dialog-head"><div><p class="eyebrow">Purchase record</p><h2>${escapeHtml(purchase.invoice_number || `Purchase #${purchase.id}`)}</h2></div><button class="icon-button" type="button" data-purchase-close aria-label="Close">${icon("close")}</button></div>
    <dl class="detail-list"><div><dt>Date</dt><dd>${escapeHtml(purchase.purchase_date)}</dd></div><div><dt>Vendor</dt><dd>#${escapeHtml(purchase.vendor_id)}</dd></div><div><dt>Warehouse</dt><dd>#${escapeHtml(purchase.warehouse_id)}</dd></div></dl>
    <h3>Items</h3><div class="invoice-detail-lines">${items.map((item) => `<div><span>Product #${escapeHtml(item.product_id)} · ${escapeHtml(item.quantity)} × ${money(item.unit_cost)}</span><strong>${money(item.total_cost)}</strong></div>`).join("")}</div>
    <dl class="detail-list"><div><dt>Subtotal</dt><dd>${money(purchase.subtotal)}</dd></div><div><dt>Discount</dt><dd>${money(purchase.discount)}</dd></div><div><dt>Tax</dt><dd>${money(purchase.tax)}</dd></div><div><dt>Total</dt><dd><strong>${money(purchase.total)}</strong></dd></div></dl>${purchase.notes ? `<p class="muted">${escapeHtml(purchase.notes)}</p>` : ""}`;
}

export function validatePurchaseDraft(input) {
  const amount = (value, label, positive = false) => {
    const number = Number(value);
    if (String(value ?? "").trim() === "" || !Number.isFinite(number) || number < 0 || (positive && number === 0)) throw new Error(`${label} must be ${positive ? "greater than zero" : "zero or greater"}.`);
    return number;
  };
  const items = input.items.map((item, index) => ({
    product_id: positiveId(item.product_id, `Product on line ${index + 1}`),
    quantity: amount(item.quantity, `Quantity on line ${index + 1}`, true),
    unit_cost: amount(item.unit_cost, `Unit cost on line ${index + 1}`, true),
  }));
  if (!items.length || items.length > 500) throw new Error("Enter between 1 and 500 purchase lines.");
  const purchaseDate = String(input.purchase_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) throw new Error("Purchase date is required.");
  const invoiceNumber = String(input.invoice_number ?? "").trim();
  if (invoiceNumber.length > 100) throw new Error("Invoice number must be 100 characters or fewer.");
  const notes = String(input.notes ?? "").trim();
  if (notes.length > 2000) throw new Error("Notes must be 2000 characters or fewer.");
  const discount = amount(input.discount, "Discount");
  const tax = amount(input.tax, "Tax");
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);
  if (discount >= subtotal + tax) throw new Error("Discount must be less than the subtotal plus tax.");
  return {
    vendor_id: positiveId(input.vendor_id, "Vendor"), warehouse_id: positiveId(input.warehouse_id, "Warehouse"),
    purchase_date: purchaseDate, items, discount, tax,
    ...(invoiceNumber ? { invoice_number: invoiceNumber } : {}), ...(notes ? { notes } : {}),
  };
}

function option(id, label) { return `<option value="${escapeHtml(id)}" label="${escapeHtml(label)}"></option>`; }
function lineMarkup() {
  return `<div class="invoice-entry-line"><label>Product ID<input name="product_id" type="number" min="1" step="1" list="purchase-product-options" required></label><label>Quantity<input name="quantity" type="number" min="0.000001" step="any" value="1" required></label><label>Unit cost (PKR)<input name="unit_cost" type="number" min="0.000001" step="any" required></label><button class="icon-button" type="button" data-purchase-remove-line aria-label="Remove line">${icon("close")}</button></div>`;
}

export function mountPurchases(container, options = {}) {
  const context = options.context ?? getWorkspaceContext(options.storage ?? globalThis.sessionStorage);
  let purchases = [];
  let nextCursor = null;
  let products = [];
  let pendingDraft = null;
  let pendingKey = null;
  container.innerHTML = `<section class="page-heading"><div><p class="eyebrow">Purchasing</p><h1>Purchases</h1><p class="page-intro">Supplier purchases in your current workspace.</p></div><button class="button primary" type="button" data-purchase-new>+ New Purchase</button></section><section class="surface"><div class="section-head"><h2>Purchase register</h2><button class="button secondary" type="button" data-purchase-refresh>Refresh</button></div><div id="purchase-results" aria-live="polite"></div><button class="button secondary" type="button" data-purchase-next hidden>Load more</button></section>
    <dialog id="purchase-detail" class="side-dialog"><div id="purchase-detail-content"></div></dialog>
    <dialog id="purchase-editor" class="invoice-dialog"><form id="purchase-form"><div class="side-dialog-head"><div><p class="eyebrow">Supplier purchase</p><h2>New Purchase</h2></div><button class="icon-button" type="button" data-purchase-editor-close aria-label="Close">${icon("close")}</button></div><p class="muted">Posting a purchase updates stock, vendor payables, and accounting through the existing purchase service.</p><div class="invoice-entry-meta"><label>Vendor ID<input name="vendor_id" type="number" min="1" step="1" list="purchase-vendor-options" required><datalist id="purchase-vendor-options"></datalist></label><label>Warehouse ID<input name="warehouse_id" type="number" min="1" step="1" list="purchase-warehouse-options" required><datalist id="purchase-warehouse-options"></datalist></label><label>Purchase date<input name="purchase_date" type="date" required></label><label>Supplier invoice number (optional)<input name="invoice_number" maxlength="100"></label></div><datalist id="purchase-product-options"></datalist><div id="purchase-lines"></div><button class="button secondary" type="button" data-purchase-add-line>+ Add line</button><div class="invoice-entry-meta"><label>Discount (PKR)<input name="discount" type="number" min="0" step="any" value="0" required></label><label>Tax (PKR)<input name="tax" type="number" min="0" step="any" value="0" required></label></div><label>Notes<textarea name="notes" maxlength="2000"></textarea></label><p id="purchase-form-result" class="form-message" role="alert" hidden></p><div id="purchase-review" hidden></div><div class="dialog-actions"><button class="button secondary" type="button" data-purchase-editor-close>Cancel</button><button class="button primary" type="submit" id="purchase-action">Review Purchase</button></div></form></dialog>`;
  const results = container.querySelector("#purchase-results");
  const next = container.querySelector("[data-purchase-next]");
  const detail = container.querySelector("#purchase-detail");
  const editor = container.querySelector("#purchase-editor");
  const form = container.querySelector("#purchase-form");
  const lines = container.querySelector("#purchase-lines");
  const message = container.querySelector("#purchase-form-result");
  const review = container.querySelector("#purchase-review");
  const action = container.querySelector("#purchase-action");
  const field = (name) => form.elements.namedItem(name);
  const showError = (error) => { message.textContent = purchaseErrorMessage(error); message.hidden = false; };
  const resetReview = () => { pendingDraft = null; pendingKey = null; review.hidden = true; action.textContent = "Review Purchase"; };

  async function load(append = false) {
    if (!context) { results.innerHTML = `<div class="empty-state"><h2>Choose your workspace</h2><p>Choose an authorized business and branch to view purchases.</p><button class="button secondary" type="button" data-open-workspace>Choose workspace</button></div>`; return; }
    if (!append) results.innerHTML = `<div class="loading-state"><span class="spinner"></span>Loading purchases...</div>`;
    try {
      const page = await listPurchases(context, { cursor: append ? nextCursor : undefined });
      purchases = append ? [...purchases, ...page.data] : page.data;
      nextCursor = page.next_cursor;
      results.innerHTML = purchaseListMarkup(purchases);
      next.hidden = nextCursor == null;
    } catch (error) { results.innerHTML = `<div class="empty-state error-state"><h2>Purchases unavailable</h2><p>${escapeHtml(purchaseErrorMessage(error))}</p></div>`; }
  }

  async function openDetail(id) {
    try {
      const response = await getPurchase(context, id);
      container.querySelector("#purchase-detail-content").innerHTML = purchaseDetailMarkup(response.data);
      detail.showModal();
    } catch (error) { results.innerHTML = `<div class="empty-state error-state"><h2>Purchase unavailable</h2><p>${escapeHtml(purchaseErrorMessage(error))}</p></div>`; }
  }

  async function openEditor() {
    if (!context) { globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace")); return; }
    form.reset(); resetReview(); message.hidden = true; lines.replaceChildren();
    field("purchase_date").value = new Date().toISOString().slice(0, 10);
    editor.showModal();
    try {
      const [vendorPage, warehousePage, productPage] = await Promise.all([listVendors(context, { limit: 100 }), listWarehouses(context, { limit: 100 }), listProducts(context, { limit: 100 })]);
      products = productPage.data ?? [];
      container.querySelector("#purchase-vendor-options").innerHTML = (vendorPage.data ?? []).map((vendor) => option(vendor.id, vendor.name)).join("");
      container.querySelector("#purchase-warehouse-options").innerHTML = (warehousePage.data ?? []).map((warehouse) => option(warehouse.id, warehouse.name)).join("");
      container.querySelector("#purchase-product-options").innerHTML = products.map((product) => option(product.id, `${product.name} · ${product.sku}`)).join("");
      lines.insertAdjacentHTML("beforeend", lineMarkup());
      field("vendor_id").focus();
    } catch (error) { showError(error); }
  }

  form.addEventListener("input", resetReview);
  form.addEventListener("change", (event) => {
    resetReview();
    if (event.target.name !== "product_id") return;
    const product = products.find((item) => item.id === Number(event.target.value));
    const row = event.target.closest(".invoice-entry-line");
    if (product?.purchase_price != null && row && !row.querySelector('[name="unit_cost"]').value) row.querySelector('[name="unit_cost"]').value = product.purchase_price;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); message.hidden = true;
    if (action.disabled) return;
    if (!pendingDraft) {
      try {
        pendingDraft = validatePurchaseDraft({
          vendor_id: field("vendor_id").value, warehouse_id: field("warehouse_id").value,
          purchase_date: field("purchase_date").value, invoice_number: field("invoice_number").value,
          discount: field("discount").value, tax: field("tax").value, notes: field("notes").value,
          items: [...lines.querySelectorAll(".invoice-entry-line")].map((row) => Object.fromEntries(["product_id", "quantity", "unit_cost"].map((name) => [name, row.querySelector(`[name="${name}"]`).value]))),
        });
        const subtotal = pendingDraft.items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);
        review.innerHTML = `<strong>Review before posting</strong><p>${pendingDraft.items.length} line(s) · estimated total ${money(subtotal - pendingDraft.discount + pendingDraft.tax)}.</p><p>Stock, vendor payables, and accounting will update when you post.</p>`;
        review.hidden = false; action.textContent = "Post Purchase"; pendingKey = globalThis.crypto.randomUUID();
      } catch (error) { showError(error); }
      return;
    }
    action.disabled = true;
    try {
      const response = await createPurchase(context, pendingDraft, pendingKey);
      editor.close();
      await load();
      await openDetail(response.data.purchase.id);
    } catch (error) { showError(error); }
    finally { action.disabled = false; }
  });

  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-open-workspace]")) globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace"));
    if (event.target.closest("[data-purchase-refresh]")) void load();
    if (event.target.closest("[data-purchase-next]") && nextCursor != null) void load(true);
    if (event.target.closest("[data-purchase-new]")) void openEditor();
    if (event.target.closest("[data-purchase-add-line]")) { lines.insertAdjacentHTML("beforeend", lineMarkup()); resetReview(); }
    const remove = event.target.closest("[data-purchase-remove-line]");
    if (remove && lines.querySelectorAll(".invoice-entry-line").length > 1) { remove.closest(".invoice-entry-line").remove(); resetReview(); }
    const row = event.target.closest("[data-purchase-id]");
    if (row) void openDetail(Number(row.dataset.purchaseId));
    if (event.target.closest("[data-purchase-close]")) detail.close();
    if (event.target.closest("[data-purchase-editor-close]")) editor.close();
  });
  void load();
}

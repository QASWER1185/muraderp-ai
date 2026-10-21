import { icon } from "./icons.js";
import { listProducts } from "./product-api.js";
import { listCustomers } from "./customer-api.js";
import { listVendors } from "./vendor-api.js";
import { createRateList, createRateListVersion, getRateList, listRateLists, publishRateListVersion, resolveRateListPrice } from "./rate-list-api.js";
import { getWorkspaceContext } from "./workspace-context.js";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const today = () => new Date().toISOString().slice(0, 10);
const money = (value, currency = "PKR") => `${escapeHtml(currency)} ${Number(value).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
const formatDate = (value) => String(value ?? "").slice(0, 10);

export function validateRateList(input) {
  const name = String(input.name ?? "").trim();
  const code = String(input.code ?? "").trim();
  if (!name || !code) throw new Error("Name and code are required.");
  const price_type = String(input.price_type);
  const scope_type = String(input.scope_type);
  if (!["SALE", "PURCHASE"].includes(price_type)) throw new Error("Choose Sale or Purchase pricing.");
  if (!["GLOBAL", "CUSTOMER", "VENDOR"].includes(scope_type)) throw new Error("Choose a Rate List scope.");
  if (price_type === "SALE" && scope_type === "VENDOR" || price_type === "PURCHASE" && scope_type === "CUSTOMER") throw new Error("The scope does not match the pricing type.");
  const ownerId = Number(input.owner_id);
  if (scope_type !== "GLOBAL" && (!Number.isSafeInteger(ownerId) || ownerId <= 0)) throw new Error(`Choose an authorized ${scope_type.toLowerCase()}.`);
  return { name, code, price_type, scope_type, currency_code: "PKR", ...(scope_type === "CUSTOMER" ? { customer_id: ownerId } : {}), ...(scope_type === "VENDOR" ? { vendor_id: ownerId } : {}) };
}

export function validateRateListVersion(input, products) {
  const version_number = Number(input.version_number);
  if (!Number.isSafeInteger(version_number) || version_number <= 0) throw new Error("Version number must be a positive whole number.");
  const effective_from = String(input.effective_from ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective_from)) throw new Error("Choose an effective date.");
  if (!Array.isArray(input.items) || !input.items.length) throw new Error("Add at least one product rate.");
  const tiers = new Set();
  const items = input.items.map((row, index) => {
    const product_id = Number(row.product_id);
    const product = products.find((candidate) => candidate.id === product_id);
    if (!product) throw new Error(`Choose an authorized product on item ${index + 1}.`);
    const minimum_quantity = Number(row.minimum_quantity);
    if (!Number.isFinite(minimum_quantity) || minimum_quantity <= 0) throw new Error(`Minimum quantity must be greater than zero on item ${index + 1}.`);
    const unit_price = Number(row.unit_price);
    if (String(row.unit_price).trim() === "" || !Number.isFinite(unit_price) || unit_price < 0) throw new Error(`Rate must be zero or greater on item ${index + 1}.`);
    const key = `${product_id}|${minimum_quantity}`;
    if (tiers.has(key)) throw new Error(`Duplicate product and quantity tier on item ${index + 1}.`);
    tiers.add(key);
    return { product_id, minimum_quantity, unit_price, unit: product.unit };
  });
  return { version_number, effective_from, items };
}

function listMarkup(lists) {
  if (!lists.length) return `<div class="empty-state">${icon("tags", 26)}<h2>No Rate Lists yet</h2><p>Create a list for Sale or Purchase pricing.</p></div>`;
  return `<div class="invoice-list">${lists.map((list) => `<button class="invoice-row" type="button" data-rate-list-id="${list.id}"><span><strong>${escapeHtml(list.name)}</strong><small>${escapeHtml(list.code)} · ${escapeHtml(list.price_type)} · ${escapeHtml(list.scope_type)}${list.scope_type === "CUSTOMER" ? ` #${list.customer_id}` : list.scope_type === "VENDOR" ? ` #${list.vendor_id}` : ""}</small></span><span class="status-pill ${list.is_active ? "neutral" : "review"}">${list.is_active ? "Available" : "Inactive"}</span>${icon("chevron")}</button>`).join("")}</div>`;
}

export function rateListDetailMarkup(detail) {
  const { list, versions } = detail;
  return `<div class="side-dialog-head"><div><p class="eyebrow">${escapeHtml(list.price_type)} pricing</p><h2>${escapeHtml(list.name)}</h2><p class="muted">${escapeHtml(list.code)} · ${escapeHtml(list.scope_type)} · ${escapeHtml(list.currency_code)}</p></div><button class="icon-button" type="button" data-rate-detail-close aria-label="Close">${icon("close")}</button></div>
    <p class="muted">Draft a complete version with product rates, then publish it. Publishing archives the previous active version.</p>
    <button class="button primary" type="button" data-rate-version-new>+ Draft Version</button>
    <div class="rate-version-list">${versions.length ? versions.map((version) => `<section class="rate-version"><div class="section-head"><div><h3>Version ${version.version_number} <span class="status-pill ${version.status === "ACTIVE" ? "neutral" : "review"}">${version.status}</span></h3><p class="muted">Effective ${escapeHtml(formatDate(version.effective_from))} · ${version.items.length} item${version.items.length === 1 ? "" : "s"}</p></div>${version.status === "DRAFT" ? `<button class="button secondary compact" type="button" data-rate-publish="${version.id}">Publish</button>` : ""}</div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Product / brand</th><th>Min qty</th><th>Rate</th></tr></thead><tbody>${version.items.map((item) => `<tr><td><strong>${escapeHtml(item.product?.name ?? `Product #${item.product_id}`)}</strong><br><small>${escapeHtml(item.product?.sku ?? "")} · ${item.product?.brand_id ? `Brand #${item.product.brand_id}` : "No brand"}</small></td><td>${item.minimum_quantity} ${escapeHtml(item.unit)}</td><td>${money(item.unit_price, list.currency_code)}</td></tr>`).join("")}</tbody></table></div></section>`).join("") : `<div class="empty-state compact-empty"><h3>No versions yet</h3><p>Add a draft version with product rates.</p></div>`}</div>
    <section class="rate-price-check"><h3>Check active rate</h3><div class="invoice-entry-meta"><label>Product<select name="price_product_id" data-rate-price-product></select></label><label>Quantity<input name="price_quantity" type="number" min="0.001" step="any" value="1"></label><label>Pricing date<input name="price_date" type="date" value="${today()}"></label></div><button class="button secondary" type="button" data-rate-price-check>Resolve Price</button><p id="rate-price-result" class="form-message" aria-live="polite"></p></section>`;
}

export function mountRateLists(container, options = {}) {
  const context = options.context ?? getWorkspaceContext(options.storage ?? globalThis.sessionStorage);
  let lists = [];
  let selected = null;
  let products = [];
  let owners = [];
  const loadAll = async (fetchPage) => { const rows = []; let cursor; do { const page = await fetchPage(cursor); rows.push(...(page.data ?? [])); cursor = page.next_cursor; } while (cursor != null && rows.length < 2000); return rows; };
  container.innerHTML = `<section class="page-heading"><div><p class="eyebrow">Catalogue pricing</p><h1>Rate Lists</h1><p class="page-intro">Keep product rates in dated versions and publish one active version per list.</p></div><button class="button primary" type="button" data-rate-list-new>+ New Rate List</button></section>
    <section class="surface"><div class="section-head"><h2>Rate List register</h2><button class="button secondary" type="button" data-rate-refresh>Refresh</button></div><div id="rate-list-results" aria-live="polite"></div></section>
    <dialog id="rate-list-detail" class="side-dialog"><div id="rate-list-detail-content"></div></dialog>
    <dialog id="rate-list-editor" class="invoice-dialog"><form id="rate-list-form"><div class="side-dialog-head"><div><p class="eyebrow">Pricing</p><h2>New Rate List</h2></div><button class="icon-button" type="button" data-rate-editor-close aria-label="Close">${icon("close")}</button></div><div class="invoice-entry-meta"><label>Name<input name="name" required maxlength="200"></label><label>Code<input name="code" required maxlength="100"></label><label>Price type<select name="price_type"><option value="SALE">Sale</option><option value="PURCHASE">Purchase</option></select></label><label>Scope<select name="scope_type"><option value="GLOBAL">Global</option><option value="CUSTOMER">Customer</option><option value="VENDOR">Vendor</option></select></label><label id="rate-owner-field" hidden>Customer or vendor<select name="owner_id"></select></label></div><p id="rate-list-message" class="form-message" role="alert" hidden></p><div class="dialog-actions"><button class="button secondary" type="button" data-rate-editor-close>Cancel</button><button class="button primary" type="submit">Create Rate List</button></div></form></dialog>
    <dialog id="rate-version-editor" class="invoice-dialog"><form id="rate-version-form"><div class="side-dialog-head"><div><p class="eyebrow">Rate List version</p><h2>Draft product rates</h2></div><button class="icon-button" type="button" data-rate-version-close aria-label="Close">${icon("close")}</button></div><div class="invoice-entry-meta"><label>Version number<input name="version_number" type="number" min="1" step="1" required></label><label>Effective from<input name="effective_from" type="date" required></label></div><label>Find a product<input name="product_search" type="search" placeholder="Search name or SKU"></label><div id="rate-version-items"></div><button class="button secondary" type="button" data-rate-item-add>+ Add Product Rate</button><p id="rate-version-message" class="form-message" role="alert" hidden></p><div class="dialog-actions"><button class="button secondary" type="button" data-rate-version-close>Cancel</button><button class="button primary" type="submit">Save Draft Version</button></div></form></dialog>`;
  const results = container.querySelector("#rate-list-results");
  const detail = container.querySelector("#rate-list-detail");
  const editor = container.querySelector("#rate-list-editor");
  const versionEditor = container.querySelector("#rate-version-editor");
  const listForm = container.querySelector("#rate-list-form");
  const versionForm = container.querySelector("#rate-version-form");
  const listMessage = container.querySelector("#rate-list-message");
  const versionMessage = container.querySelector("#rate-version-message");
  const show = (node, error) => { node.textContent = error instanceof Error ? error.message : String(error); node.hidden = false; };

  async function refresh() {
    if (!context) { results.innerHTML = `<div class="empty-state"><h2>Choose your workspace</h2><p>Choose an authorized business and branch to use Rate Lists.</p><button class="button secondary" type="button" data-open-workspace>Choose workspace</button></div>`; return; }
    results.innerHTML = `<div class="loading-state">Loading Rate Lists...</div>`;
    try { lists = (await listRateLists(context)).data ?? []; results.innerHTML = listMarkup(lists); }
    catch (error) { results.innerHTML = `<div class="empty-state error-state"><h2>Rate Lists unavailable</h2><p>${escapeHtml(error.message)}</p></div>`; }
  }

  async function openDetail(id) {
    detail.querySelector("#rate-list-detail-content").innerHTML = `<div class="loading-state">Loading Rate List...</div>`;
    if (!detail.open) detail.showModal();
    try {
      selected = (await getRateList(context, id)).data;
      detail.querySelector("#rate-list-detail-content").innerHTML = rateListDetailMarkup(selected);
      const activeItems = selected.versions.find((version) => version.status === "ACTIVE")?.items ?? [];
      detail.querySelector("[data-rate-price-product]").innerHTML = `<option value="">Choose product</option>${activeItems.map((item) => `<option value="${item.product_id}">${escapeHtml(item.product?.name ?? `Product #${item.product_id}`)} · ${escapeHtml(item.product?.sku ?? "")}</option>`).join("")}`;
    } catch (error) { detail.querySelector("#rate-list-detail-content").innerHTML = `<button class="icon-button" type="button" data-rate-detail-close aria-label="Close">${icon("close")}</button><p>${escapeHtml(error.message)}</p>`; }
  }

  function updateOwner() {
    const type = listForm.elements.price_type.value;
    const scope = listForm.elements.scope_type.value;
    if (type === "SALE" && scope === "VENDOR" || type === "PURCHASE" && scope === "CUSTOMER") { listForm.elements.scope_type.value = "GLOBAL"; }
    const actual = listForm.elements.scope_type.value;
    const field = container.querySelector("#rate-owner-field"); field.hidden = actual === "GLOBAL";
    const matches = owners.filter((owner) => owner.kind === actual);
    listForm.elements.owner_id.innerHTML = `<option value="">Choose ${actual.toLowerCase()}</option>${matches.map((owner) => `<option value="${owner.id}">${escapeHtml(owner.name)}</option>`).join("")}`;
  }

  async function openListEditor() {
    if (!context) { globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace")); return; }
    listForm.reset(); listMessage.hidden = true; owners = []; updateOwner(); editor.showModal();
    try {
      const [customers, vendors] = await Promise.all([
        loadAll((cursor) => listCustomers(context, { cursor, limit: 100 })),
        loadAll((cursor) => listVendors(context, { cursor, limit: 100 })),
      ]);
      owners = [...customers.map((customer) => ({ kind: "CUSTOMER", id: customer.id, name: customer.name })), ...vendors.map((vendor) => ({ kind: "VENDOR", id: vendor.id, name: vendor.name }))];
      updateOwner();
    } catch (error) { show(listMessage, error); }
  }

  function productOptions(selectedId = "") {
    return `<option value="">Choose product</option>${products.map((product) => `<option value="${product.id}" ${String(product.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(product.name)} · ${escapeHtml(product.sku)}${product.brand_id ? ` · Brand #${product.brand_id}` : ""} (${escapeHtml(product.unit)})</option>`).join("")}`;
  }
  function addItem(productId = "") {
    const row = document.createElement("div"); row.className = "invoice-entry-line rate-item-row";
    row.innerHTML = `<label>Product<select name="product_id" required>${productOptions(productId)}</select></label><label>Min qty<input name="minimum_quantity" type="number" min="0.001" step="any" value="1" required></label><label>Rate (PKR)<input name="unit_price" type="number" min="0" step="any" required></label><button class="icon-button" type="button" data-rate-item-remove aria-label="Remove rate">${icon("close")}</button>`;
    container.querySelector("#rate-version-items").append(row);
  }
  async function openVersionEditor() {
    if (!selected) return;
    versionForm.reset(); versionMessage.hidden = true;
    versionForm.elements.version_number.value = String(Math.max(0, ...selected.versions.map((version) => version.version_number)) + 1);
    versionForm.elements.effective_from.value = today();
    container.querySelector("#rate-version-items").replaceChildren();
    versionEditor.showModal();
    try { products = await loadAll((cursor) => listProducts(context, { cursor, limit: 100 })); addItem(); }
    catch (error) { show(versionMessage, error); }
  }

  listForm.addEventListener("change", (event) => { if (["price_type", "scope_type"].includes(event.target.name)) updateOwner(); });
  listForm.addEventListener("submit", async (event) => {
    event.preventDefault(); listMessage.hidden = true;
    const button = listForm.querySelector('[type="submit"]'); button.disabled = true;
    try { const input = validateRateList(Object.fromEntries(new FormData(listForm))); const created = (await createRateList(context, input)).data; editor.close(); await refresh(); await openDetail(created.id); }
    catch (error) { show(listMessage, error); } finally { button.disabled = false; }
  });
  versionForm.addEventListener("submit", async (event) => {
    event.preventDefault(); versionMessage.hidden = true;
    const button = versionForm.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const rows = [...container.querySelectorAll(".rate-item-row")].map((row) => ({ product_id: row.querySelector('[name="product_id"]').value, minimum_quantity: row.querySelector('[name="minimum_quantity"]').value, unit_price: row.querySelector('[name="unit_price"]').value }));
      const input = validateRateListVersion({ version_number: versionForm.elements.version_number.value, effective_from: versionForm.elements.effective_from.value, items: rows }, products);
      await createRateListVersion(context, selected.list.id, input); versionEditor.close(); await openDetail(selected.list.id);
    } catch (error) { show(versionMessage, error); } finally { button.disabled = false; }
  });
  container.addEventListener("input", async (event) => {
    if (event.target.name !== "product_search") return;
    const term = event.target.value.trim();
    if (!term) return;
    try {
      const found = (await listProducts(context, { search: term, limit: 100 })).data ?? [];
      const selectedProducts = products.filter((product) => [...container.querySelectorAll('.rate-item-row [name="product_id"]')].some((select) => Number(select.value) === product.id));
      products = [...new Map([...selectedProducts, ...found].map((product) => [product.id, product])).values()];
      for (const select of container.querySelectorAll('.rate-item-row [name="product_id"]')) { const prior = select.value; select.innerHTML = productOptions(prior); select.value = prior; }
    } catch (error) { show(versionMessage, error); }
  });
  container.addEventListener("click", async (event) => {
    if (event.target.closest("[data-open-workspace]")) globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace"));
    if (event.target.closest("[data-rate-refresh]")) void refresh();
    if (event.target.closest("[data-rate-list-new]")) void openListEditor();
    if (event.target.closest("[data-rate-detail-close]")) detail.close();
    if (event.target.closest("[data-rate-editor-close]")) editor.close();
    if (event.target.closest("[data-rate-version-close]")) versionEditor.close();
    if (event.target.closest("[data-rate-version-new]")) void openVersionEditor();
    if (event.target.closest("[data-rate-item-add]")) addItem();
    if (event.target.closest("[data-rate-item-remove]")) event.target.closest(".rate-item-row").remove();
    const row = event.target.closest("[data-rate-list-id]"); if (row) void openDetail(Number(row.dataset.rateListId));
    const publish = event.target.closest("[data-rate-publish]");
    if (publish && selected) {
      publish.disabled = true;
      try { await publishRateListVersion(context, selected.list.id, Number(publish.dataset.ratePublish)); await openDetail(selected.list.id); }
      catch (error) { globalThis.alert(error.message); publish.disabled = false; }
    }
    if (event.target.closest("[data-rate-price-check]") && selected) {
      const output = detail.querySelector("#rate-price-result"); output.textContent = "Resolving...";
      try {
        const productId = detail.querySelector('[name="price_product_id"]').value;
        if (!productId) throw new Error("Choose a product from the active version.");
        const query = { product_id: productId, quantity: detail.querySelector('[name="price_quantity"]').value, as_of: detail.querySelector('[name="price_date"]').value };
        if (selected.list.scope_type === "CUSTOMER") query.customer_id = selected.list.customer_id;
        if (selected.list.scope_type === "VENDOR") query.vendor_id = selected.list.vendor_id;
        const result = (await resolveRateListPrice(context, selected.list.id, query)).data;
        output.textContent = result ? `${money(result.unit_price, result.currency_code)} per ${result.unit} · Version #${result.rate_list_version_id} · minimum ${result.minimum_quantity}` : "No effective active rate matches this product, quantity, and date.";
      } catch (error) { output.textContent = error.message; }
    }
  });
  void refresh();
}

import { icon } from "./icons.js";
import { createProduct, getProduct, listProducts, updateProduct } from "./product-api.js";
import { getWorkspaceContext } from "./workspace-context.js";

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function productErrorMessage(error) {
  if (error?.status === 401) return "Sign in to search your product catalogue.";
  if (error?.status === 403) return "You do not have access to Products for this workspace.";
  if (error?.status === 404 && error?.code === "NOT_FOUND") return "This Product is no longer available in this workspace.";
  if (error?.status === 404) return "The Product service is not connected to this frontend deployment.";
  return error instanceof Error ? error.message : "Products could not be loaded.";
}

export function productRowsMarkup(products) {
  return products.map((product) => `<button class="product-row" type="button" data-product-id="${escapeHtml(product.id)}">
    <span class="product-avatar">${escapeHtml(String(product.name).slice(0, 2).toUpperCase())}</span>
    <span class="product-main"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)} | ${escapeHtml(product.category)}</small></span>
    <span class="product-meta"><strong>${escapeHtml(product.unit)}</strong><small>${product.brand_id == null ? "No brand assigned" : "Brand linked"}</small></span>
    <span class="product-price"><strong>PKR ${Number(product.sale_price ?? 0).toLocaleString("en-PK")}</strong><small>Standard sale price</small></span>
    ${icon("chevron")}
  </button>`).join("");
}

function requiredText(value, label, maxLength) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return text;
}

export function validateProductDraft(input) {
  const price = (value, label) => {
    if (String(value ?? "").trim() === "") throw new Error(`${label} is required.`);
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label} must be zero or greater.`);
    return amount;
  };
  const brand = String(input?.brand_id ?? "").trim();
  if (brand && (!/^\d+$/.test(brand) || Number(brand) <= 0 || !Number.isSafeInteger(Number(brand)))) throw new Error("Brand ID must be a positive whole number.");
  return {
    name: requiredText(input?.name, "Product name", 200),
    sku: requiredText(input?.sku, "SKU", 100),
    category: requiredText(input?.category, "Category", 120),
    unit: requiredText(input?.unit, "Unit", 50),
    purchase_price: String(input?.purchase_price ?? "").trim() === "" ? null : price(input.purchase_price, "Purchase price"),
    sale_price: price(input?.sale_price, "Sale price"),
    brand_id: brand ? Number(brand) : null,
  };
}

export function productPageMarkup() {
  return `<section class="page-heading"><div><p class="eyebrow">Catalogue</p><h1>Products</h1><p class="page-intro">Find stock items by product name or SKU.</p></div><button class="button primary" type="button" data-product-new>+ New Product</button></section>
    <section class="surface product-browser">
      <form id="product-search-form" class="search-toolbar" role="search">
        <label class="search-box" for="product-search">${icon("search")}<input id="product-search" name="search" type="search" placeholder="Search products or SKU" autocomplete="off" /><kbd>/</kbd></label>
        <button class="icon-button" type="button" data-product-refresh title="Refresh products" aria-label="Refresh products">${icon("refresh")}</button>
      </form>
      <div id="product-results" class="product-results" aria-live="polite"></div>
    </section>
    <dialog id="product-detail" class="side-dialog"><div id="product-detail-content"></div></dialog>
    <dialog id="product-editor" class="side-dialog">${productEditorMarkup()}</dialog>`;
}

export function productEditorMarkup() {
  return `<div><form id="product-form" class="modal-card">
    <div class="side-dialog-head"><div><p class="eyebrow">Product record</p><h2 id="product-editor-title">New Product</h2></div><button class="icon-button" type="button" data-product-editor-close aria-label="Close">${icon("close")}</button></div>
    <label>Product name<input name="name" maxlength="200" required /></label>
    <label>SKU<input name="sku" maxlength="100" required /></label>
    <label>Category<input name="category" maxlength="120" required /></label>
    <label>Unit<input name="unit" maxlength="50" required /></label>
    <label>Purchase price (if known)<input name="purchase_price" type="number" min="0" step="any" /></label>
    <label>Sale price<input name="sale_price" type="number" min="0" step="any" required /></label>
    <label>Brand ID (optional)<input name="brand_id" type="number" min="1" step="1" /></label>
    <p id="product-form-result" class="form-message" role="alert" hidden></p>
    <div class="dialog-actions"><button class="button secondary" type="button" data-product-editor-close>Cancel</button><button id="product-save" class="button primary" type="submit">Save Product</button></div>
  </form></div>`;
}

export function productDetailMarkup(product) {
  return `<div class="side-dialog-head"><div><p class="eyebrow">Product details</p><h2>${escapeHtml(product.name)}</h2></div><button class="icon-button" type="button" data-product-close aria-label="Close">${icon("close")}</button></div>
    <dl class="detail-list"><div><dt>SKU</dt><dd>${escapeHtml(product.sku)}</dd></div><div><dt>Category</dt><dd>${escapeHtml(product.category)}</dd></div><div><dt>Unit</dt><dd>${escapeHtml(product.unit)}</dd></div><div><dt>Sale price</dt><dd>PKR ${Number(product.sale_price ?? 0).toLocaleString("en-PK")}</dd></div><div><dt>Purchase price</dt><dd>${product.purchase_price == null ? "Not set" : `PKR ${Number(product.purchase_price).toLocaleString("en-PK")}`}</dd></div><div><dt>Brand</dt><dd>${product.brand_id == null ? "Not assigned" : "Assigned"}</dd></div></dl>
    <button class="button primary" type="button" data-product-edit>Edit Product</button>`;
}

export async function saveProductAndRefresh(context, product, draft, refresh) {
  const response = product ? await updateProduct(context, product.id, draft) : await createProduct(context, draft);
  const refreshed = await refresh(response.data.sku);
  if (!refreshed?.some((row) => row.id === response.data.id)) {
    throw new Error("Product was saved, but could not be confirmed in the refreshed list. Refresh and search for its SKU.");
  }
  return response.data;
}

export function mountProducts(container, options = {}) {
  const storage = options.storage ?? globalThis.sessionStorage;
  const context = options.context ?? getWorkspaceContext(storage);
  let products = [];
  let activeRequest = 0;
  let debounceTimer;

  container.innerHTML = productPageMarkup();

  const form = container.querySelector("#product-search-form");
  const input = container.querySelector("#product-search");
  const results = container.querySelector("#product-results");
  const dialog = container.querySelector("#product-detail");
  const detail = container.querySelector("#product-detail-content");
  const editor = container.querySelector("#product-editor");
  const editorForm = container.querySelector("#product-form");
  const editorResult = container.querySelector("#product-form-result");
  const saveButton = container.querySelector("#product-save");
  let selectedProduct = null;

  function field(name) { return editorForm.elements.namedItem(name); }
  function openEditor(product = null) {
    if (!context) { globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace")); return; }
    selectedProduct = product;
    editorForm.reset();
    editorResult.hidden = true;
    editorForm.querySelector("#product-editor-title").textContent = product ? "Edit Product" : "New Product";
    for (const name of ["name", "sku", "category", "unit", "purchase_price", "sale_price", "brand_id"]) {
      field(name).value = product?.[name] ?? "";
    }
    dialog.close();
    editor.showModal();
    field("name").focus();
  }

  function render() {
    if (!context) {
      results.innerHTML = `<div class="empty-state">${icon("building", 26)}<h2>Choose your workspace</h2><p>Product records stay private until your business and branch are selected.</p><button class="button secondary" type="button" data-open-workspace>Choose workspace</button></div>`;
      return;
    }
    if (products.length === 0) {
      const term = input.value.trim();
      results.innerHTML = `<div class="empty-state">${icon(term ? "search" : "package", 26)}<h2>${term ? "No matching products" : "No products yet"}</h2><p>${term ? `Nothing matched &quot;${escapeHtml(term)}&quot;. Try a product name or SKU.` : "Products for this workspace will appear here."}</p></div>`;
      return;
    }
    results.innerHTML = `<div class="result-summary"><span>${products.length} product${products.length === 1 ? "" : "s"}</span><span>Name, SKU, category and price</span></div><div class="product-list">${productRowsMarkup(products)}</div>`;
  }

  async function load() {
    if (!context) { render(); return; }
    const requestId = ++activeRequest;
    results.innerHTML = `<div class="loading-state" role="status"><span class="spinner"></span><span>Searching products...</span></div>`;
    try {
      const page = await listProducts(context, { search: input.value, limit: 50 });
      if (requestId !== activeRequest) return;
      products = page.data ?? [];
      render();
      return products;
    } catch (error) {
      if (requestId !== activeRequest) return;
      results.innerHTML = `<div class="empty-state error-state">${icon("alert", 26)}<h2>Products unavailable</h2><p>${escapeHtml(productErrorMessage(error))}</p><button class="button secondary" type="button" data-product-retry>Try again</button></div>`;
      return null;
    }
  }

  form.addEventListener("submit", (event) => { event.preventDefault(); clearTimeout(debounceTimer); void load(); });
  input.addEventListener("input", () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(() => void load(), 280); });
  container.querySelector("[data-product-refresh]").addEventListener("click", () => void load());
  container.querySelector("[data-product-new]").addEventListener("click", () => openEditor());
  editor.addEventListener("click", (event) => { if (event.target.closest("[data-product-editor-close]")) editor.close(); });
  editorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!context || saveButton.disabled) return;
    editorResult.hidden = true;
    let draft;
    try {
      draft = validateProductDraft(Object.fromEntries(["name", "sku", "category", "unit", "purchase_price", "sale_price", "brand_id"].map((name) => [name, field(name).value])));
    } catch (error) {
      editorResult.textContent = error.message;
      editorResult.hidden = false;
      return;
    }
    saveButton.disabled = true;
    try {
      await saveProductAndRefresh(context, selectedProduct, draft, async (sku) => {
        input.value = sku;
        return load();
      });
      editor.close();
    } catch (error) {
      editorResult.textContent = productErrorMessage(error);
      editorResult.hidden = false;
    } finally {
      saveButton.disabled = false;
    }
  });
  results.addEventListener("click", async (event) => {
    const workspaceButton = event.target.closest("[data-open-workspace]");
    if (workspaceButton) { globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace")); return; }
    const retry = event.target.closest("[data-product-retry]");
    if (retry) { void load(); return; }
    const row = event.target.closest("[data-product-id]");
    if (!row || !context) return;
    detail.innerHTML = `<div class="loading-state"><span class="spinner"></span><span>Loading product...</span></div>`;
    dialog.showModal();
    try {
      const response = await getProduct(context, row.dataset.productId);
      const product = response.data;
      detail.innerHTML = productDetailMarkup(product);
      detail.querySelector("[data-product-edit]").addEventListener("click", () => openEditor(product));
    } catch (error) {
      detail.innerHTML = `<div class="side-dialog-head"><h2>Product unavailable</h2><button class="icon-button" type="button" data-product-close aria-label="Close">${icon("close")}</button></div><div class="empty-state error-state"><p>${escapeHtml(productErrorMessage(error))}</p></div>`;
    }
  });
  dialog.addEventListener("click", (event) => { if (event.target.closest("[data-product-close]")) dialog.close(); });
  globalThis.onkeydown = (event) => { if (event.key === "/" && !event.metaKey && !event.ctrlKey && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") { event.preventDefault(); input.focus(); } };
  void load();
}

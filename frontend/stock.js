import { icon } from "./icons.js";
import { listProducts } from "./product-api.js";
import { listStockBalances, listStockMovements } from "./stock-api.js";
import { listWarehouses } from "./warehouse-api.js";
import { getWorkspaceContext } from "./workspace-context.js";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

export function stockErrorMessage(error) {
  if (error?.status === 401) return "Sign in to view stock.";
  if (error?.status === 403) return "You do not have permission to view stock in this workspace.";
  return error instanceof Error ? error.message : "Stock could not be loaded.";
}

export function stockBalancesMarkup(balances, products = [], warehouses = []) {
  if (!balances.length) return `<div class="empty-state">${icon("boxes", 26)}<h2>No stock recorded</h2><p>Authorized stock will appear after a purchase is posted.</p></div>`;
  const productById = new Map(products.map((product) => [product.id, product]));
  const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
  return `<div class="table-wrap"><table class="stock-table"><thead><tr><th>Product</th><th>Warehouse</th><th>Quantity</th></tr></thead><tbody>${balances.map((balance) => {
    const product = productById.get(balance.product_id);
    const warehouse = warehouseById.get(balance.warehouse_id);
    return `<tr><td><strong>${escapeHtml(product?.name ?? `Product #${balance.product_id}`)}</strong><small>${escapeHtml(product?.sku ?? `#${balance.product_id}`)}</small></td><td>${escapeHtml(warehouse?.name ?? `Warehouse #${balance.warehouse_id}`)}</td><td><strong>${escapeHtml(balance.quantity)} ${escapeHtml(product?.unit ?? "")}</strong></td></tr>`;
  }).join("")}</tbody></table></div>`;
}

export function stockMovementsMarkup(movements, products = [], warehouses = []) {
  if (!movements.length) return `<div class="empty-state">${icon("boxes", 26)}<h2>No stock movements</h2><p>Posted purchases and other stock transactions will appear here.</p></div>`;
  const productById = new Map(products.map((product) => [product.id, product]));
  const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
  return `<div class="table-wrap"><table class="stock-table"><thead><tr><th>Movement</th><th>Product</th><th>Warehouse</th><th>Quantity</th><th>Source</th></tr></thead><tbody>${movements.map((movement) => `<tr><td>${escapeHtml(movement.movement_type)}</td><td>${escapeHtml(productById.get(movement.product_id)?.name ?? `Product #${movement.product_id}`)}</td><td>${escapeHtml(warehouseById.get(movement.warehouse_id)?.name ?? `Warehouse #${movement.warehouse_id}`)}</td><td>${escapeHtml(movement.quantity)}</td><td>${escapeHtml(movement.reference_type ?? "—")}${movement.reference_id == null ? "" : ` #${escapeHtml(movement.reference_id)}`}</td></tr>`).join("")}</tbody></table></div>`;
}

export function mountStock(container, options = {}) {
  const context = options.context ?? getWorkspaceContext(options.storage ?? globalThis.sessionStorage);
  let balances = [];
  let movements = [];
  let products = [];
  let warehouses = [];
  let balanceCursor = null;
  let movementCursor = null;
  container.innerHTML = `<section class="page-heading"><div><p class="eyebrow">Inventory</p><h1>Stock</h1><p class="page-intro">Authorized inventory balances and branch stock movements.</p></div><button class="button secondary" type="button" data-stock-refresh>Refresh</button></section><section class="surface"><div class="section-head"><h2>Inventory balances</h2></div><div id="stock-balances" aria-live="polite"></div><button class="button secondary" type="button" data-stock-more-balances hidden>Load more stock</button></section><section class="surface"><div class="section-head"><h2>Branch movements</h2></div><div id="stock-movements" aria-live="polite"></div><button class="button secondary" type="button" data-stock-more-movements hidden>Load more movements</button></section>`;
  const balanceContent = container.querySelector("#stock-balances");
  const movementContent = container.querySelector("#stock-movements");
  const moreBalances = container.querySelector("[data-stock-more-balances]");
  const moreMovements = container.querySelector("[data-stock-more-movements]");

  async function load(kind = "both", append = false) {
    if (!context) {
      const message = `<div class="empty-state"><h2>Choose your workspace</h2><p>Choose an authorized business and branch to view stock.</p><button class="button secondary" type="button" data-open-workspace>Choose workspace</button></div>`;
      balanceContent.innerHTML = message; movementContent.innerHTML = message;
      return;
    }
    if (!append) {
      if (kind !== "movements") balanceContent.innerHTML = `<div class="loading-state"><span class="spinner"></span>Loading inventory...</div>`;
      if (kind !== "balances") movementContent.innerHTML = `<div class="loading-state"><span class="spinner"></span>Loading movements...</div>`;
    }
    try {
      if (!append) {
        const [productPage, warehousePage] = await Promise.all([listProducts(context, { limit: 100 }), listWarehouses(context, { limit: 100 })]);
        products = productPage.data ?? [];
        warehouses = warehousePage.data ?? [];
      }
      const [balancePage, movementPage] = await Promise.all([
        kind === "movements" ? null : listStockBalances(context, { cursor: append ? balanceCursor : undefined }),
        kind === "balances" ? null : listStockMovements(context, { cursor: append ? movementCursor : undefined }),
      ]);
      if (balancePage) {
        balances = append ? [...balances, ...balancePage.data] : balancePage.data;
        balanceCursor = balancePage.next_cursor;
        balanceContent.innerHTML = stockBalancesMarkup(balances, products, warehouses);
        moreBalances.hidden = balanceCursor == null;
      }
      if (movementPage) {
        movements = append ? [...movements, ...movementPage.data] : movementPage.data;
        movementCursor = movementPage.next_cursor;
        movementContent.innerHTML = stockMovementsMarkup(movements, products, warehouses);
        moreMovements.hidden = movementCursor == null;
      }
    } catch (error) {
      const message = `<div class="empty-state error-state"><h2>Stock unavailable</h2><p>${escapeHtml(stockErrorMessage(error))}</p></div>`;
      if (kind !== "movements") balanceContent.innerHTML = message;
      if (kind !== "balances") movementContent.innerHTML = message;
    }
  }

  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-open-workspace]")) globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace"));
    if (event.target.closest("[data-stock-refresh]")) void load();
    if (event.target.closest("[data-stock-more-balances]") && balanceCursor != null) void load("balances", true);
    if (event.target.closest("[data-stock-more-movements]") && movementCursor != null) void load("movements", true);
  });
  void load();
}

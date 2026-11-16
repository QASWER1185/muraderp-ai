import { reportPeriod, periodLabel, periodPills } from "./report-period.js";
import { getDashboardEstimateCount, getDashboardMetric, getDashboardStock } from "./dashboard-api.js";
import { icon } from "./icons.js";
import { getWorkspaceContext } from "./workspace-context.js";

const STORE = {
  name: "M. MURAD BUILDING MATERIAL STORE",
  categories: "Electric • Sanitary • Cement • Bricks • Sand • Gravel",
  phone: "0308 6235608",
  address: "Plaza No. 4, Al Kabir Town, Raiwind Road, Lahore",
};

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function money(value) {
  return new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(Number(value));
}

function stockRows(items) {
  return items.slice(0, 6).map((item) => `<tr>
    <td><span class="stock-product"><span>${escapeHtml(item.product_name.slice(0, 2).toUpperCase())}</span><span><strong>${escapeHtml(item.product_name)}</strong><small>${escapeHtml(item.sku ?? "No SKU")}</small></span></span></td>
    <td><strong>${Number(item.current_stock).toLocaleString("en-PK")}</strong></td>
    <td>${escapeHtml(item.unit)}</td>
    <td>${item.rate == null ? '<span class="muted">Unavailable</span>' : money(item.rate)}</td>
    <td><span class="stock-status ${item.status === "OUT_OF_STOCK" ? "danger" : "good"}">${item.status === "OUT_OF_STOCK" ? "Out of stock" : "In stock"}</span></td>
  </tr>`).join("");
}

function dashboardStockMobileCards(items) {
  return `<div class="dashboard-stock-mobile-cards">${items.filter((item) => !/steel|rebar|سریا/i.test(String(item.product_name ?? ""))).slice(0, 6).map((item) => {
    const low = item.status === "OUT_OF_STOCK" || item.status === "LOW_STOCK";
    return `<article class="dashboard-stock-mobile-card"><div><span>${escapeHtml(String(item.product_name ?? "").slice(0, 2).toUpperCase())}</span><strong dir="auto">${escapeHtml(item.product_name)}</strong></div><span><small>Stock Qty</small><strong>${Number(item.current_stock).toLocaleString("en-PK")} ${escapeHtml(item.unit)}</strong></span><span class="stock-status ${low ? "danger" : "good"}">${low ? "Low Stock" : "In Stock"}</span></article>`;
  }).join("")}</div>`;
}

function activityRows(items) {
  if (!items.length) return `<div class="dashboard-empty compact"><span>${icon("chart", 22)}</span><strong>No recent stock activity</strong><small>New inventory movements will appear here.</small></div>`;
  return items.map((item) => `<div class="activity-row"><span class="activity-icon">${icon(item.quantity < 0 ? "arrowUp" : "boxes", 16)}</span><span><strong>${escapeHtml(item.product_name)}</strong><small>${escapeHtml(String(item.movement_type).replaceAll("_", " "))}</small></span><span><strong>${Number(item.quantity).toLocaleString("en-PK")}</strong><small>${new Date(item.created_at).toLocaleDateString("en-PK")}</small></span></div>`).join("");
}

function mobileActivityRows(items) {
  const visible = items.filter((item) => !/steel|rebar|سریا/i.test(String(item.product_name ?? "")));
  return visible.length ? visible.map((item) => `<div class="activity-row"><span class="activity-icon">${icon(item.quantity < 0 ? "arrowUp" : "boxes", 16)}</span><span><strong dir="auto">${escapeHtml(item.product_name)}</strong><small>${escapeHtml(String(item.movement_type).replaceAll("_", " "))}</small></span><span><strong>${Number(item.quantity).toLocaleString("en-PK")}</strong><small>${new Date(item.created_at).toLocaleDateString("en-PK")}</small></span></div>`).join("") : `<div class="dashboard-empty compact"><strong>No recent stock activity</strong><small>New inventory movements will appear here.</small></div>`;
}

const dateRange = range => reportPeriod(range);

function trendPeriods() {
  const today = new Date();
  return Array.from({ length: 6 }, (_, index) => {
    const first = new Date(today.getFullYear(), today.getMonth() - 5 + index, 1);
    const last = index === 5 ? today : new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const format = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { label: first.toLocaleDateString("en-PK", { month: "short" }), from: format(first), to: format(last) };
  });
}

export function dashboardMarkup() {
  const now = new Date();
  const today = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const quickActions = [
    ["estimates/create", "New Estimate", "file"],
    ["invoices", "New Invoice", "receipt"],
    ["customers", "Add Customer", "users"],
    ["products", "Add Product", "package"],
    ["inventory", "View Stock", "boxes"],
    ["reports", "Sales Report", "chart"],
  ];
  return `<div class="dashboard-page"><header class="dashboard-header-stack">
  <section class="dashboard-store-card" aria-label="Store Identification">
    <div class="dashboard-store-heading">
      <div class="dashboard-store-monogram" aria-hidden="true"><span>M</span></div>
      <div class="dashboard-store-identity"><h1>${escapeHtml(STORE.name)}</h1><p>${escapeHtml(STORE.categories)}</p></div>
    </div>
    <div class="dashboard-store-contact"><span class="dashboard-store-address">${icon("location", 15)}<span>${escapeHtml(STORE.address)}</span></span><a href="tel:03086235608">${icon("phone", 15)} <span>0308-6235608</span></a></div>
  </section>
  <div class="mobile-dashboard-date"><span>${icon("calendar", 16)}</span><time datetime="${todayIso}">${escapeHtml(today)}</time></div>
  </header>

  <section class="dashboard-section mobile-dashboard-metrics-section" aria-label="Live business metrics"><div class="mobile-dashboard-metrics">
    <div class="dashboard-period-card"><button class="mobile-dashboard-metric" type="button" data-dashboard-metric="sales"><span class="mobile-metric-icon">${icon("chart", 18)}</span><span class="mobile-metric-copy"><span class="mobile-metric-label">Total Sales</span><strong data-mobile-metric-value="sales">Loading</strong><small data-mobile-metric-note="sales">Posted sales this month</small></span></button>${periodPills("data-sales-range")}</div>
    <button class="mobile-dashboard-metric" type="button" data-dashboard-metric="estimates"><span class="mobile-metric-icon">${icon("file", 18)}</span><span class="mobile-metric-copy"><span class="mobile-metric-label">Total Estimates</span><strong data-mobile-metric-value="estimates">Loading</strong><small data-mobile-metric-note="estimates">Active</small></span></button>
    <button class="mobile-dashboard-metric" type="button" data-dashboard-metric="receivables"><span class="mobile-metric-icon">${icon("wallet", 18)}</span><span class="mobile-metric-copy"><span class="mobile-metric-label">Receivables</span><strong data-mobile-metric-value="receivables">Loading</strong><small class="mobile-metric-pending" data-mobile-metric-note="receivables">Pending</small></span></button>
    <div class="dashboard-period-card"><button class="mobile-dashboard-metric" type="button" data-profit-open><span class="mobile-metric-icon">${icon("trendUp", 18)}</span><span class="mobile-metric-copy"><span class="mobile-metric-label">Profit / Loss</span><strong data-mobile-profit-value>Loading</strong><small data-mobile-profit-note>This month</small></span></button>${periodPills("data-profit-card-range")}</div>
  </div></section>

  <section class="dashboard-section dashboard-overview-section"><div class="dashboard-section-title"><div><p class="eyebrow">Business snapshot</p><h2>Overview</h2></div><span class="privacy-note">Financial figures open on request</span></div>
    <div class="premium-metric-grid" aria-label="Business summary">
      ${[["sales","Total Sales","chart","Current month"],["estimates","Total Estimates","file","All estimates in this branch"],["receivables","Receivables","wallet","Balance as of today"]].map(([key, label, iconName, note]) => `<div class="dashboard-period-card"><button class="premium-metric" type="button" data-dashboard-metric="${key}"><span class="premium-metric-icon">${icon(iconName)}</span><div><p>${label}</p><strong data-metric-value="${key}">View details</strong><small data-metric-note="${key}">${note} · Open on request</small></div><span class="metric-arrow">${icon("chevron", 16)}</span></button>${key === "sales" ? periodPills("data-sales-range") : ""}</div>`).join("")}
      <article class="premium-metric"><span class="premium-metric-icon green">${icon("boxes")}</span><div><p>Inventory Items</p><strong id="inventory-count">Loading</strong><small id="inventory-count-note">Checking authorized stock</small></div><span class="metric-arrow">${icon("chevron", 16)}</span></article>
      <div class="dashboard-period-card"><button class="premium-metric profit-metric" type="button" data-profit-open><span class="premium-metric-icon amber">${icon("trendUp")}</span><div><p>Profit / Loss</p><strong data-desktop-profit-value>Loading</strong><small data-desktop-profit-note>This month</small></div><span class="metric-arrow">${icon("chevron", 16)}</span></button>${periodPills("data-profit-card-range")}</div>
    </div>
  </section>

  <section class="dashboard-section dashboard-actions-section"><div class="dashboard-section-title"><div><p class="eyebrow">Common tasks</p><h2>Quick Actions</h2></div></div><div class="dashboard-desktop-actions"><button class="action-estimate" type="button" data-navigate="estimates/create">${icon("plus", 19)}<strong>New Estimate</strong></button><button class="action-invoice" type="button" data-navigate="invoices">${icon("receipt", 19)}<strong>New Invoice</strong></button><button class="action-customer" type="button" data-navigate="customers">${icon("userPlus", 19)}<strong>Add Customer</strong></button><button class="action-stock" type="button" data-navigate="inventory">${icon("boxes", 19)}<strong>View Stock</strong></button></div><div class="quick-action-strip">${quickActions.map(([route, label, iconName]) => `<button type="button" data-navigate="${route}"><span>${icon(iconName, 19)}</span><strong>${label}</strong></button>`).join("")}</div><div class="mobile-quick-actions"><button type="button" class="action-estimate" data-navigate="estimates/create">${icon("plus", 19)}<strong>New Estimate</strong></button><button type="button" class="action-invoice" data-navigate="invoices">${icon("receipt", 19)}<strong>New Invoice</strong></button><button type="button" class="action-customer" data-navigate="customers">${icon("userPlus", 19)}<strong>Add Customer</strong></button><button type="button" class="action-stock" data-navigate="inventory">${icon("boxes", 19)}<strong>View Stock</strong></button></div></section>

  <button class="mobile-stock-summary" type="button" data-navigate="inventory" aria-label="Stock Summary. Tap to view Stock."><span class="mobile-stock-summary-heading"><span class="mobile-stock-cube">${icon("boxes", 17)}</span><strong>Stock Summary</strong></span><span class="mobile-stock-stats"><span><small>Total Items:</small><strong id="mobile-inventory-count">Loading</strong></span><span class="mobile-stock-divider" aria-hidden="true"></span><span><small>Low Stock:</small><strong id="mobile-low-stock-count">Loading</strong></span></span><span class="mobile-stock-view-details">View details →</span><span class="dashboard-stock-subtitle dashboard-stock-tags"><span>Sanitary</span><span>Electric</span><span>Cement</span><span>Sand</span><span>Gravel</span><span>Bricks</span></span><span class="mobile-stock-hint">› Tap to view detailed stock<span class="stock-hint-categories"> • sanitary • electric • cement • sand • gravel • bricks</span></span></button>

  <div class="dashboard-layout">
    <section class="surface stock-overview"><div class="surface-heading"><div><p class="eyebrow">Inventory</p><h2>Stock Overview</h2></div><button class="button secondary compact" type="button" data-navigate="inventory">View All Stock ${icon("chevron", 14)}</button></div>
      <div id="stock-overview-content" class="dashboard-loading" role="status"><span class="spinner"></span><span>Loading authorized stock...</span></div>
    </section>
    <section class="surface low-stock-card"><div class="surface-heading"><div><p class="eyebrow">Needs attention</p><h2>Low Stock Items</h2></div><span class="alert-badge">!</span></div><div id="low-stock-content" class="dashboard-loading small" role="status"><span class="spinner"></span><span>Checking stock...</span></div><div id="low-stock-mobile-content"></div></section>
  </div>

  <div class="analytics-layout">
    <section class="surface sales-chart-card"><div class="surface-heading"><div><p class="eyebrow">Sales analytics</p><h2>Sales Trend</h2></div><button class="button secondary compact" type="button" data-sales-trend>Load Sales Trend</button></div><div id="sales-trend-content" class="dashboard-empty compact"><strong>Six months of posted sales</strong><small>Open on request from the authorized reporting service.</small></div></section>
    <section class="surface recent-activity"><div class="surface-heading"><div><p class="eyebrow">Live operations</p><h2>Recent Activity</h2></div></div><div id="recent-activity-content" class="dashboard-loading small" role="status"><span class="spinner"></span><span>Loading activity...</span></div><div id="recent-activity-mobile-content"></div></section>
  </div>

  <section class="dashboard-copilot-card"><div class="copilot-orb">${icon("sparkles", 25)}</div><div><p class="eyebrow">MuradERP AI</p><h2>Your business copilot is ready to help</h2><p>Prepare an estimate, read a material list, or review an ERP action in one conversation. Nothing is posted without your confirmation.</p></div><button class="button primary" type="button" data-open-copilot>Open Copilot ${icon("arrowRight", 16)}</button></section>

  <dialog id="profit-dialog" class="modal-dialog profit-dialog"><div class="profit-panel"><div class="surface-heading"><div><p class="eyebrow">Private financial view</p><h2>Profit</h2></div><button class="icon-button" type="button" data-profit-close aria-label="Close">${icon("close")}</button></div>${periodPills("data-profit-range")}<div id="profit-context" class="profit-context"></div><div id="profit-content" class="dashboard-loading" role="status"><span class="spinner"></span><span>Loading verified profit...</span></div></div></dialog></div>`;
}

export function mountDashboard(container, options = {}) {
  const root = container.querySelector(".dashboard-page");
  const context = options.context ?? getWorkspaceContext(options.storage ?? globalThis.sessionStorage);
  const stockContent = container.querySelector("#stock-overview-content");
  const lowStockContent = container.querySelector("#low-stock-content");
  const activityContent = container.querySelector("#recent-activity-content");
  const activityMobileContent = container.querySelector("#recent-activity-mobile-content");
  const lowStockMobileContent = container.querySelector("#low-stock-mobile-content");
  const inventoryCount = container.querySelector("#inventory-count");
  const inventoryCountNote = container.querySelector("#inventory-count-note");
  const mobileInventoryCount = container.querySelector("#mobile-inventory-count");
  const mobileLowStockCount = container.querySelector("#mobile-low-stock-count");
  const mobileProfitValue = container.querySelector("[data-mobile-profit-value]");
  const mobileProfitNote = container.querySelector("[data-mobile-profit-note]");
  const profitDialog = container.querySelector("#profit-dialog");
  const profitContent = container.querySelector("#profit-content");
  const profitContext = container.querySelector("#profit-context");
  const trendContent = container.querySelector("#sales-trend-content");

  function dashboardUnavailable(message, withWorkspace = false) {
    return `<div class="dashboard-empty"><span>${icon("alert", 20)}</span><strong>Live data unavailable</strong><small>${escapeHtml(message)}</small>${withWorkspace ? '<button class="button secondary compact" type="button" data-open-workspace>Choose workspace</button>' : ""}</div>`;
  }

  async function loadStock() {
    if (!context) {
      const state = dashboardUnavailable("Choose your business workspace to load authorized inventory.", true);
      stockContent.innerHTML = state; lowStockContent.innerHTML = state; activityContent.innerHTML = state; activityMobileContent.innerHTML = state; lowStockMobileContent.innerHTML = state;
      inventoryCount.textContent = "Unavailable"; inventoryCountNote.textContent = "Workspace not selected";
      mobileInventoryCount.textContent = "Unavailable"; mobileLowStockCount.textContent = "Unavailable";
      return;
    }
    try {
      const response = await (options.getStock ?? getDashboardStock)(context);
      const data = response.data;
      const items = data.inventory_items ?? [];
      inventoryCount.textContent = data.inventory_truncated ? `${items.length}+` : String(items.length);
      inventoryCountNote.textContent = data.inventory_truncated ? "More items available" : "Authorized stock products";
      mobileInventoryCount.textContent = data.inventory_truncated ? `${items.length}+` : String(items.length);
      stockContent.innerHTML = items.length ? `<div class="table-wrap"><table class="stock-table"><thead><tr><th>Product / Item</th><th>Current Stock</th><th>Unit</th><th>Rate</th><th>Stock Status</th></tr></thead><tbody>${stockRows(items)}</tbody></table></div>${dashboardStockMobileCards(items)}` : `<div class="dashboard-empty"><span>${icon("boxes", 22)}</span><strong>No inventory items</strong><small>Stock will appear after inventory is recorded.</small></div>`;
      const outOfStock = items.filter((item) => item.status === "OUT_OF_STOCK" || item.status === "LOW_STOCK");
      mobileLowStockCount.textContent = data.reorder_levels_available ? String(outOfStock.length) : String(items.filter((item) => item.status === "OUT_OF_STOCK").length);
      lowStockContent.innerHTML = outOfStock.length ? `<div class="low-stock-list">${outOfStock.slice(0, 4).map((item) => `<div><span>${escapeHtml(item.product_name.slice(0, 2).toUpperCase())}</span><span><strong>${escapeHtml(item.product_name)}</strong><small>${Number(item.current_stock).toLocaleString("en-PK")} ${escapeHtml(item.unit)} available</small></span><span class="stock-status danger">Out</span></div>`).join("")}</div>${data.reorder_levels_available ? "" : '<p class="reorder-note">Configured reorder levels are not available yet.</p>'}` : `<div class="dashboard-empty compact"><span>${icon("check", 21)}</span><strong>No out-of-stock items</strong><small>${data.reorder_levels_available ? "Stock is above configured reorder levels." : "Reorder levels are not exposed by the backend yet."}</small></div>`;
      const mobileLowStock = outOfStock.filter((item) => !/steel|rebar|سریا/i.test(String(item.product_name ?? "")));
      lowStockMobileContent.innerHTML = mobileLowStock.length ? `<div class="low-stock-list">${mobileLowStock.slice(0, 4).map((item) => `<div><span>${escapeHtml(item.product_name.slice(0, 2).toUpperCase())}</span><span><strong dir="auto">${escapeHtml(item.product_name)}</strong><small>${Number(item.current_stock).toLocaleString("en-PK")} ${escapeHtml(item.unit)} available</small></span><span class="stock-status danger">Low Stock</span></div>`).join("")}</div>` : `<div class="dashboard-empty compact"><strong>No low stock items</strong></div>`;
      activityContent.innerHTML = activityRows(data.recent_activity ?? []);
      activityMobileContent.innerHTML = mobileActivityRows(data.recent_activity ?? []);
    } catch (error) {
      const message = error?.status === 401 ? "Sign in to load authorized dashboard data." : error?.status === 403 ? "You do not have access to inventory for this workspace." : "The dashboard stock service is not connected.";
      const state = dashboardUnavailable(message);
      stockContent.innerHTML = state; lowStockContent.innerHTML = state; activityContent.innerHTML = state; activityMobileContent.innerHTML = state; lowStockMobileContent.innerHTML = state;
      inventoryCount.textContent = "Unavailable"; inventoryCountNote.textContent = message;
      mobileInventoryCount.textContent = "Unavailable"; mobileLowStockCount.textContent = "Unavailable";
    }
  }

  let salesRange = "monthly", profitRange = "monthly", profitGeneration = 0, salesGeneration = 0, dialogGeneration = 0;
  const markPills = (attribute, range) => container.querySelectorAll(`[${attribute}]`).forEach(button => { const active = button.getAttribute(attribute) === range; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
  async function loadProfit(range) {
    const generation = ++dialogGeneration;
    container.querySelectorAll("[data-profit-range]").forEach((button) => button.classList.toggle("active", button.dataset.profitRange === range));
    const period = dateRange(range);
    profitContext.textContent = periodLabel(period);
    markPills("data-profit-range", range);
    profitContent.className = "dashboard-loading";
    profitContent.innerHTML = '<span class="spinner"></span><span>Loading verified profit...</span>';
    if (!context) { profitContent.innerHTML = dashboardUnavailable("Choose your workspace before opening private financial data.", true); return; }
    try {
      const [response, lossResponse] = await Promise.all([(options.getMetric ?? getDashboardMetric)(context, "profit", period), (options.getMetric ?? getDashboardMetric)(context, "loss", period)]);
      const value = Number(response.data?.value ?? response.value) - Number(lossResponse.data?.value ?? lossResponse.value);
      if (!Number.isFinite(value)) throw new Error("Profit value is unavailable");
      if (generation !== dialogGeneration) return;
      profitContent.className = "profit-value";
      profitContent.innerHTML = `<span>${range === "daily" ? "Daily" : range === "weekly" ? "Weekly" : "Monthly"} Profit / Loss</span><strong>${money(value)}</strong><small>Verified by the reporting service</small>`;
    } catch (error) {
      if (generation !== dialogGeneration) return;
      profitContent.className = "";
      profitContent.innerHTML = dashboardUnavailable(error?.status === 401 ? "Sign in to view profit." : error?.status === 403 ? "You do not have permission to view reports." : "Profit reporting is not connected to this frontend yet.");
    }
  }

  async function loadMetric(key) {
    const generation = key === "sales" ? ++salesGeneration : 0;
    const selectedPeriod = dateRange(key === "sales" ? salesRange : "daily");
    const valueNode = container.querySelector(`[data-metric-value="${key}"]`);
    const noteNode = container.querySelector(`[data-metric-note="${key}"]`);
    const mobileValueNode = container.querySelector(`[data-mobile-metric-value="${key}"]`);
    const mobileNoteNode = container.querySelector(`[data-mobile-metric-note="${key}"]`);
    const values = [valueNode, mobileValueNode].filter(Boolean);
    const notes = [noteNode, mobileNoteNode].filter(Boolean);
    values.forEach((node) => { node.textContent = "Loading..."; });
    if (!context) { values.forEach((node) => { node.textContent = "Unavailable"; }); notes.forEach((node) => { node.textContent = "Choose a workspace"; }); return; }
    try {
      const result = key === "estimates"
        ? await (options.getEstimateCount ?? getDashboardEstimateCount)(context)
        : await (options.getMetric ?? getDashboardMetric)(context, key, selectedPeriod);
      const value = key === "estimates" ? result.data?.count : result.data?.value;
      if (value == null || !Number.isFinite(Number(value))) throw new Error("Invalid dashboard value");
      if (key === "sales" && generation !== salesGeneration) return;
      const formatted = key === "estimates" ? Number(value).toLocaleString("en-PK") : money(value);
      values.forEach((node) => { node.textContent = formatted; });
      notes.forEach((node) => { node.textContent = key === "sales" ? `Net posted sales · ${periodLabel(selectedPeriod)}` : key === "estimates" ? `All records as of ${selectedPeriod.to}` : `Cumulative as of ${selectedPeriod.to}`; });
    } catch (error) {
      if (key === "sales" && generation !== salesGeneration) return;
      values.forEach((node) => { node.textContent = "Unavailable"; });
      const note = error?.status === 401 ? "Sign in to view" : error?.status === 403 ? "Access denied for this branch" : "Could not load live data";
      notes.forEach((node) => { node.textContent = note; });
    }
  }

  async function loadMobileProfit() {
    const generation = ++profitGeneration;
    markPills("data-profit-card-range", profitRange);
    const valueNodes = [mobileProfitValue, container.querySelector("[data-desktop-profit-value]")].filter(Boolean);
    const noteNodes = [mobileProfitNote, container.querySelector("[data-desktop-profit-note]")].filter(Boolean);
    valueNodes.forEach(node => { node.textContent = "Loading..."; });
    if (!mobileProfitValue) return;
    if (!context) { valueNodes.forEach(node => { node.textContent = "Unavailable"; }); noteNodes.forEach(node => { node.textContent = "Choose a workspace"; }); return; }
    try {
      const period = dateRange(profitRange);
      const [profitResult, lossResult] = await Promise.all([
        (options.getMetric ?? getDashboardMetric)(context, "profit", period),
        (options.getMetric ?? getDashboardMetric)(context, "loss", period),
      ]);
      const profit = Number(profitResult.data?.value ?? profitResult.value);
      const loss = Number(lossResult.data?.value ?? lossResult.value);
      if (!Number.isFinite(profit) || !Number.isFinite(loss)) throw new Error("Invalid profit/loss value");
      if (generation !== profitGeneration) return;
      const net = profit - loss;
      valueNodes.forEach(node => { node.textContent = `${net < 0 ? "−" : ""}${money(Math.abs(net))}`; });
      noteNodes.forEach(node => { node.textContent = `${net < 0 ? "Loss" : "Net profit"} · ${periodLabel(period)}`; });
    } catch (error) {
      if (generation !== profitGeneration) return;
      valueNodes.forEach(node => { node.textContent = "Unavailable"; });
      noteNodes.forEach(node => { node.textContent = error?.status === 401 ? "Sign in to view" : error?.status === 403 ? "Access denied" : "Could not load live data"; });
    }
  }

  async function loadTrend() {
    trendContent.className = "dashboard-loading";
    trendContent.textContent = "Loading authorized sales trend...";
    if (!context) { trendContent.innerHTML = dashboardUnavailable("Choose a workspace to view sales trend.", true); return; }
    try {
      const periods = trendPeriods();
      const responses = await Promise.all(periods.map(({ from, to }) => (options.getMetric ?? getDashboardMetric)(context, "sales", { from, to })));
      const values = responses.map((response) => Number(response.data?.value));
      if (values.some((value) => !Number.isFinite(value))) throw new Error("Invalid sales trend");
      const highest = Math.max(...values, 1);
      trendContent.className = "sales-trend";
      trendContent.innerHTML = `<div class="sales-trend-bars" role="img" aria-label="Monthly posted sales for the last six months">${values.map((value, index) => `<div class="sales-trend-month"><strong>${money(value)}</strong><span class="sales-trend-track"><span style="height:${Math.max(2, value / highest * 100)}%"></span></span><small>${escapeHtml(periods[index].label)}</small></div>`).join("")}</div>`;
    } catch (error) {
      trendContent.className = "";
      trendContent.innerHTML = dashboardUnavailable(error?.status === 401 ? "Sign in to view sales trend." : error?.status === 403 ? "Access denied for this branch." : "Sales trend could not be loaded.");
    }
  }

  root.addEventListener("click", (event) => {
    const salesPreset = event.target.closest("[data-sales-range]")?.dataset.salesRange;
    if (salesPreset) { salesRange = salesPreset; markPills("data-sales-range", salesRange); void loadMetric("sales"); return; }
    const profitPreset = event.target.closest("[data-profit-card-range]")?.dataset.profitCardRange;
    if (profitPreset) { profitRange = profitPreset; void loadMobileProfit(); return; }
    const metric = event.target.closest("[data-dashboard-metric]")?.dataset.dashboardMetric;
    if (metric === "sales") { globalThis.location.hash = "#/invoices"; return; }
    if (metric === "receivables") { globalThis.location.hash = "#/customers"; return; }
    if (metric === "estimates") { globalThis.location.hash = "#/estimates/list"; return; }
    if (metric) void loadMetric(metric);
    if (event.target.closest("[data-sales-trend]")) void loadTrend();
    if (event.target.closest("[data-profit-open]")) { profitDialog.showModal(); void loadProfit(profitRange); }
    if (event.target.closest("[data-profit-close]")) profitDialog.close();
    const range = event.target.closest("[data-profit-range]")?.dataset.profitRange;
    if (range) void loadProfit(range);
    if (event.target.closest("[data-open-workspace]")) globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace"));
  });
  void loadStock();
  {
    void loadMetric("sales");
    void loadMetric("estimates");
    void loadMetric("receivables");
    void loadMobileProfit();
  }
}

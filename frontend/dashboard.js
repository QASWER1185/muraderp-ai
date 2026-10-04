import { getDashboardEstimateCount, getDashboardMetric, getDashboardStock } from "./dashboard-api.js";
import { icon } from "./icons.js";
import { getWorkspaceContext } from "./workspace-context.js";

const STORE = {
  name: "MURAD BUILDING MATERIALS STORE",
  categories: "Cement, Bricks, Sand, Electric, Sanitary, All Other Building Materials",
  phone: "0308 6235608",
  address: "Al Kabir Town, Raiwind Road, Lahore.",
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

function activityRows(items) {
  if (!items.length) return `<div class="dashboard-empty compact"><span>${icon("chart", 22)}</span><strong>No recent stock activity</strong><small>New inventory movements will appear here.</small></div>`;
  return items.map((item) => `<div class="activity-row"><span class="activity-icon">${icon(item.quantity < 0 ? "arrowUp" : "boxes", 16)}</span><span><strong>${escapeHtml(item.product_name)}</strong><small>${escapeHtml(String(item.movement_type).replaceAll("_", " "))}</small></span><span><strong>${Number(item.quantity).toLocaleString("en-PK")}</strong><small>${new Date(item.created_at).toLocaleDateString("en-PK")}</small></span></div>`).join("");
}

function dateRange(range) {
  const end = new Date();
  const start = new Date(end);
  if (range === "monthly") start.setDate(1);
  const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { from: localDate(start), to: localDate(end) };
}

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
  const quickActions = [
    ["estimates", "New Estimate", "file"],
    ["invoices", "New Invoice", "receipt"],
    ["customers", "Add Customer", "users"],
    ["products", "Add Product", "package"],
    ["inventory", "View Stock", "boxes"],
    ["reports", "Sales Report", "chart"],
  ];
  return `<div class="dashboard-page"><section class="business-hero">
    <div class="business-monogram" aria-hidden="true">M</div>
    <div class="business-identity"><p class="eyebrow">Welcome back</p><h1><span>M</span> ${STORE.name}</h1><p>${STORE.categories}</p><div class="business-contact"><span>${icon("phone", 15)} ${STORE.phone}</span><span>${icon("location", 15)} ${STORE.address}</span></div></div>
    <button class="button hero-copilot" type="button" data-open-copilot>${icon("sparkles")} Ask AI Copilot</button>
  </section>

  <section class="dashboard-section"><div class="dashboard-section-title"><div><p class="eyebrow">Business snapshot</p><h2>Overview</h2></div><span class="privacy-note">Financial figures open on request</span></div>
    <div class="premium-metric-grid" aria-label="Business summary">
      ${[["sales","Total Sales","chart","Current month"],["estimates","Total Estimates","file","All estimates in this branch"],["receivables","Receivables","wallet","Balance as of today"]].map(([key, label, iconName, note]) => `<button class="premium-metric" type="button" data-dashboard-metric="${key}"><span class="premium-metric-icon">${icon(iconName)}</span><div><p>${label}</p><strong data-metric-value="${key}">View details</strong><small data-metric-note="${key}">${note} · Open on request</small></div><span class="metric-arrow">${icon("chevron", 16)}</span></button>`).join("")}
      <article class="premium-metric"><span class="premium-metric-icon green">${icon("boxes")}</span><div><p>Inventory Items</p><strong id="inventory-count">Loading</strong><small id="inventory-count-note">Checking authorized stock</small></div><span class="metric-arrow">${icon("chevron", 16)}</span></article>
      <button class="premium-metric profit-metric" type="button" data-profit-open><span class="premium-metric-icon amber">${icon("trendUp")}</span><div><p>Today's Profit</p><strong>Open securely</strong><small>Daily and monthly view</small></div><span class="metric-arrow">${icon("chevron", 16)}</span></button>
    </div>
  </section>

  <section class="dashboard-section"><div class="dashboard-section-title"><div><p class="eyebrow">Common tasks</p><h2>Quick Actions</h2></div></div><div class="quick-action-strip">${quickActions.map(([route, label, iconName]) => `<button type="button" data-navigate="${route}"><span>${icon(iconName, 19)}</span><strong>${label}</strong></button>`).join("")}</div></section>

  <div class="dashboard-layout">
    <section class="surface stock-overview"><div class="surface-heading"><div><p class="eyebrow">Inventory</p><h2>Stock Overview</h2></div><button class="button secondary compact" type="button" data-navigate="inventory">View All Stock ${icon("chevron", 14)}</button></div>
      <div id="stock-overview-content" class="dashboard-loading" role="status"><span class="spinner"></span><span>Loading authorized stock...</span></div>
    </section>
    <section class="surface low-stock-card"><div class="surface-heading"><div><p class="eyebrow">Needs attention</p><h2>Low Stock Items</h2></div><span class="alert-badge">!</span></div><div id="low-stock-content" class="dashboard-loading small" role="status"><span class="spinner"></span><span>Checking stock...</span></div></section>
  </div>

  <div class="analytics-layout">
    <section class="surface sales-chart-card"><div class="surface-heading"><div><p class="eyebrow">Sales analytics</p><h2>Sales Trend</h2></div><button class="button secondary compact" type="button" data-sales-trend>Load Sales Trend</button></div><div id="sales-trend-content" class="dashboard-empty compact"><strong>Six months of posted sales</strong><small>Open on request from the authorized reporting service.</small></div></section>
    <section class="surface recent-activity"><div class="surface-heading"><div><p class="eyebrow">Live operations</p><h2>Recent Activity</h2></div></div><div id="recent-activity-content" class="dashboard-loading small" role="status"><span class="spinner"></span><span>Loading activity...</span></div></section>
  </div>

  <section class="dashboard-copilot-card"><div class="copilot-orb">${icon("sparkles", 25)}</div><div><p class="eyebrow">MuradERP AI</p><h2>Your business copilot is ready to help</h2><p>Prepare an estimate, read a material list, or review an ERP action in one conversation. Nothing is posted without your confirmation.</p></div><button class="button primary" type="button" data-open-copilot>Open Copilot ${icon("arrowRight", 16)}</button></section>

  <dialog id="profit-dialog" class="modal-dialog profit-dialog"><div class="profit-panel"><div class="surface-heading"><div><p class="eyebrow">Private financial view</p><h2>Profit</h2></div><button class="icon-button" type="button" data-profit-close aria-label="Close">${icon("close")}</button></div><div class="profit-tabs" role="tablist"><button class="active" type="button" data-profit-range="daily">Daily Profit</button><button type="button" data-profit-range="monthly">Monthly Profit</button></div><div id="profit-context" class="profit-context"></div><div id="profit-content" class="dashboard-loading" role="status"><span class="spinner"></span><span>Loading verified profit...</span></div></div></dialog></div>`;
}

export function mountDashboard(container, options = {}) {
  const root = container.querySelector(".dashboard-page");
  const context = options.context ?? getWorkspaceContext(options.storage ?? globalThis.sessionStorage);
  const stockContent = container.querySelector("#stock-overview-content");
  const lowStockContent = container.querySelector("#low-stock-content");
  const activityContent = container.querySelector("#recent-activity-content");
  const inventoryCount = container.querySelector("#inventory-count");
  const inventoryCountNote = container.querySelector("#inventory-count-note");
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
      stockContent.innerHTML = state; lowStockContent.innerHTML = state; activityContent.innerHTML = state;
      inventoryCount.textContent = "Unavailable"; inventoryCountNote.textContent = "Workspace not selected";
      return;
    }
    try {
      const response = await (options.getStock ?? getDashboardStock)(context);
      const data = response.data;
      const items = data.inventory_items ?? [];
      inventoryCount.textContent = data.inventory_truncated ? `${items.length}+` : String(items.length);
      inventoryCountNote.textContent = data.inventory_truncated ? "More items available" : "Authorized stock products";
      stockContent.innerHTML = items.length ? `<div class="table-wrap"><table class="stock-table"><thead><tr><th>Product / Item</th><th>Current Stock</th><th>Unit</th><th>Rate</th><th>Stock Status</th></tr></thead><tbody>${stockRows(items)}</tbody></table></div>` : `<div class="dashboard-empty"><span>${icon("boxes", 22)}</span><strong>No inventory items</strong><small>Stock will appear after inventory is recorded.</small></div>`;
      const outOfStock = items.filter((item) => item.status === "OUT_OF_STOCK");
      lowStockContent.innerHTML = outOfStock.length ? `<div class="low-stock-list">${outOfStock.slice(0, 4).map((item) => `<div><span>${escapeHtml(item.product_name.slice(0, 2).toUpperCase())}</span><span><strong>${escapeHtml(item.product_name)}</strong><small>${Number(item.current_stock).toLocaleString("en-PK")} ${escapeHtml(item.unit)} available</small></span><span class="stock-status danger">Out</span></div>`).join("")}</div>${data.reorder_levels_available ? "" : '<p class="reorder-note">Configured reorder levels are not available yet.</p>'}` : `<div class="dashboard-empty compact"><span>${icon("check", 21)}</span><strong>No out-of-stock items</strong><small>${data.reorder_levels_available ? "Stock is above configured reorder levels." : "Reorder levels are not exposed by the backend yet."}</small></div>`;
      activityContent.innerHTML = activityRows(data.recent_activity ?? []);
    } catch (error) {
      const message = error?.status === 401 ? "Sign in to load authorized dashboard data." : error?.status === 403 ? "You do not have access to inventory for this workspace." : "The dashboard stock service is not connected.";
      const state = dashboardUnavailable(message);
      stockContent.innerHTML = state; lowStockContent.innerHTML = state; activityContent.innerHTML = state;
      inventoryCount.textContent = "Unavailable"; inventoryCountNote.textContent = message;
    }
  }

  async function loadProfit(range) {
    container.querySelectorAll("[data-profit-range]").forEach((button) => button.classList.toggle("active", button.dataset.profitRange === range));
    const period = dateRange(range);
    profitContext.textContent = range === "daily" ? `For ${new Date(`${period.from}T00:00:00`).toLocaleDateString("en-PK", { dateStyle: "long" })}` : `${new Date(`${period.from}T00:00:00`).toLocaleDateString("en-PK", { day: "numeric", month: "long" })} – ${new Date(`${period.to}T00:00:00`).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" })}`;
    profitContent.className = "dashboard-loading";
    profitContent.innerHTML = '<span class="spinner"></span><span>Loading verified profit...</span>';
    if (!context) { profitContent.innerHTML = dashboardUnavailable("Choose your workspace before opening private financial data.", true); return; }
    try {
      const response = await (options.getMetric ?? getDashboardMetric)(context, "profit", period);
      const value = response.data?.value ?? response.value;
      if (value == null || value === "") throw new Error("Profit value is unavailable");
      profitContent.className = "profit-value";
      profitContent.innerHTML = `<span>${range === "daily" ? "Daily Profit" : "Monthly Profit"}</span><strong>${money(value)}</strong><small>Verified by the reporting service</small>`;
    } catch (error) {
      profitContent.className = "";
      profitContent.innerHTML = dashboardUnavailable(error?.status === 401 ? "Sign in to view profit." : error?.status === 403 ? "You do not have permission to view reports." : "Profit reporting is not connected to this frontend yet.");
    }
  }

  async function loadMetric(key) {
    const valueNode = container.querySelector(`[data-metric-value="${key}"]`);
    const noteNode = container.querySelector(`[data-metric-note="${key}"]`);
    valueNode.textContent = "Loading...";
    if (!context) { valueNode.textContent = "Unavailable"; noteNode.textContent = "Choose a workspace"; return; }
    try {
      const result = key === "estimates"
        ? await (options.getEstimateCount ?? getDashboardEstimateCount)(context)
        : await (options.getMetric ?? getDashboardMetric)(context, key, key === "receivables" ? dateRange("daily") : dateRange("monthly"));
      const value = key === "estimates" ? result.data?.count : result.data?.value;
      if (value == null || !Number.isFinite(Number(value))) throw new Error("Invalid dashboard value");
      valueNode.textContent = key === "estimates" ? Number(value).toLocaleString("en-PK") : money(value);
      noteNode.textContent = key === "sales" ? "Posted sales this month" : key === "estimates" ? "Estimates in this branch" : "Balance as of today";
    } catch (error) {
      valueNode.textContent = "Unavailable";
      noteNode.textContent = error?.status === 401 ? "Sign in to view" : error?.status === 403 ? "Access denied for this branch" : "Could not load live data";
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
    const metric = event.target.closest("[data-dashboard-metric]")?.dataset.dashboardMetric;
    if (metric) void loadMetric(metric);
    if (event.target.closest("[data-sales-trend]")) void loadTrend();
    if (event.target.closest("[data-profit-open]")) { profitDialog.showModal(); void loadProfit("daily"); }
    if (event.target.closest("[data-profit-close]")) profitDialog.close();
    const range = event.target.closest("[data-profit-range]")?.dataset.profitRange;
    if (range) void loadProfit(range);
    if (event.target.closest("[data-open-workspace]")) globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace"));
  });
  void loadStock();
}

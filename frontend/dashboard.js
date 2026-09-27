import { getDashboardStock } from "./dashboard-api.js";
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

function activityRows(items) {
  if (!items.length) return '<p class="dashboard-inline-state">No recent inventory movements.</p>';
  return items.slice(0, 5).map((item) => `<div class="activity-row"><span class="activity-icon">${icon(item.quantity < 0 ? "arrowUp" : "boxes", 16)}</span><span><strong>${escapeHtml(item.product_name)}</strong><small>${escapeHtml(String(item.movement_type).replaceAll("_", " "))}</small></span><span><strong>${Number(item.quantity).toLocaleString("en-PK")}</strong><small>${new Date(item.created_at).toLocaleDateString("en-PK")}</small></span></div>`).join("");
}

function dateRange(range) {
  const end = new Date();
  const start = new Date(end);
  if (range === "monthly") start.setDate(1);
  return { from: start.toLocaleDateString("en-CA"), to: end.toLocaleDateString("en-CA") };
}

function metric(label, iconName, value, note, extraClass = "") {
  return `<article class="command-metric ${extraClass}"><span class="command-metric-icon">${icon(iconName, 18)}</span><p>${label}</p><strong>${value}</strong><small>${note}</small></article>`;
}

export function dashboardMarkup() {
  const quickActions = [
    ["estimates", "New Estimate", "file"],
    ["invoices", "New Invoice", "receipt"],
    ["customers", "Add Customer", "users"],
    ["products", "Add Product", "package"],
  ];
  return `<div class="dashboard-page"><section class="business-bar" aria-label="Business identity">
    <div class="business-monogram" aria-hidden="true">M</div>
    <div class="business-identity"><h1><span>M</span> ${STORE.name}</h1><p>${STORE.categories}</p><div class="business-contact"><span>${icon("phone", 14)} ${STORE.phone}</span><span>${icon("location", 14)} ${STORE.address}</span></div></div>
    <button class="button hero-copilot" type="button" data-open-copilot>${icon("sparkles", 16)} Ask AI Copilot</button>
  </section>

  <div id="dashboard-workspace-note" class="dashboard-workspace-note" role="status" hidden><span>${icon("boxes", 18)} Select your business workspace to load live data.</span><button class="button secondary compact" type="button" data-open-workspace>Choose Workspace</button></div>

  <section class="command-section" aria-label="Business summary"><div class="command-section-heading"><div><p class="eyebrow">Business snapshot</p><h2>Overview</h2></div><span>Authorized data only</span></div>
    <div class="command-metric-grid">
      ${metric("Total Sales", "chart", "Data unavailable", "Sales reporting pending")}
      ${metric("Total Estimates", "file", "Data unavailable", "Estimate summary pending")}
      ${metric("Receivables", "wallet", "Data unavailable", "Balance reporting pending")}
      ${metric("Inventory Items", "boxes", '<span id="inventory-count">Not connected</span>', '<span id="inventory-count-note">Authorized inventory</span>', "inventory-metric")}
      <button class="command-metric profit-metric" type="button" data-profit-open><span class="command-metric-icon">${icon("trendUp", 18)}</span><p>Today's Profit</p><strong>Data unavailable</strong><small>View monthly ${icon("arrowRight", 13)}</small></button>
    </div>
  </section>

  <div class="command-business-grid">
    <section class="surface sales-overview"><div class="surface-heading"><div><p class="eyebrow">Business performance</p><h2>Sales Overview</h2></div><div class="sales-periods" aria-label="Sales period"><button type="button" class="active" aria-pressed="true" data-sales-period="today">Today</button><button type="button" aria-pressed="false" data-sales-period="week">7 Days</button><button type="button" aria-pressed="false" data-sales-period="month">This Month</button></div></div><div class="sales-unavailable">${icon("chart", 21)}<div><strong>Reporting feed pending</strong><p>Verified sales data will appear here when reporting is connected.</p></div></div><p class="sales-trend-note">Sales Trend <span>Reporting feed pending</span></p></section>
    <section class="surface inventory-health"><div class="surface-heading"><div><p class="eyebrow">Stock at a glance</p><h2>Inventory Health</h2></div><button class="text-link" type="button" data-navigate="inventory">View Inventory ${icon("arrowRight", 14)}</button></div><div class="inventory-facts"><div><span>Total Items</span><strong id="inventory-total">Not connected</strong></div><div><span>Low Stock</span><strong id="inventory-low">Unavailable</strong></div><div><span>Out of Stock</span><strong id="inventory-out">Not connected</strong></div><div><span>Stock Value</span><strong id="inventory-value">Unavailable</strong></div></div><p id="inventory-note" class="inventory-note">Reorder levels and stock valuation are unavailable.</p><div id="inventory-attention" class="inventory-attention" hidden></div></section>
  </div>

  <div class="command-operations-grid">
    <section class="surface recent-activity"><div class="surface-heading"><div><p class="eyebrow">Inventory movements</p><h2>Recent Activity</h2></div></div><div id="recent-activity-content" class="dashboard-inline-state" role="status">Not connected</div></section>
    <section class="surface quick-actions"><div class="surface-heading"><div><p class="eyebrow">Get things done</p><h2>Quick Actions</h2></div></div><div class="quick-action-grid">${quickActions.map(([route, label, iconName]) => `<button type="button" data-navigate="${route}"><span>${icon(iconName, 18)}</span><strong>${label}</strong>${icon("arrowRight", 14)}</button>`).join("")}</div></section>
  </div>

  <section class="dashboard-copilot-card"><div class="copilot-orb">${icon("sparkles", 22)}</div><div><p class="eyebrow">MuradERP AI</p><h2>Your business copilot is ready to help</h2><p>Prepare an estimate, read a material list, or review an ERP action in one conversation.</p></div><button class="button primary" type="button" data-open-copilot>Open Copilot ${icon("arrowRight", 16)}</button></section>

  <dialog id="profit-dialog" class="modal-dialog profit-dialog"><div class="profit-panel"><div class="surface-heading"><div><p class="eyebrow">Private financial view</p><h2>Profit</h2></div><button class="icon-button" type="button" data-profit-close aria-label="Close">${icon("close")}</button></div><div class="profit-tabs" role="tablist"><button class="active" type="button" data-profit-range="daily">Daily Profit</button><button type="button" data-profit-range="monthly">Monthly Profit</button></div><div id="profit-context" class="profit-context"></div><div id="profit-content" role="status"></div></div></dialog></div>`;
}

export function mountDashboard(container, options = {}) {
  const root = container.querySelector(".dashboard-page");
  const context = options.context ?? getWorkspaceContext(options.storage ?? globalThis.sessionStorage);
  const workspaceNote = root.querySelector("#dashboard-workspace-note");
  const inventoryCount = root.querySelector("#inventory-count");
  const inventoryCountNote = root.querySelector("#inventory-count-note");
  const inventoryTotal = root.querySelector("#inventory-total");
  const inventoryOut = root.querySelector("#inventory-out");
  const inventoryNote = root.querySelector("#inventory-note");
  const inventoryAttention = root.querySelector("#inventory-attention");
  const activityContent = root.querySelector("#recent-activity-content");
  const profitDialog = root.querySelector("#profit-dialog");
  const profitContent = root.querySelector("#profit-content");
  const profitContext = root.querySelector("#profit-context");

  async function loadStock() {
    if (!context) { workspaceNote.hidden = false; return; }
    inventoryCount.textContent = inventoryTotal.textContent = "Loading";
    inventoryOut.textContent = "Loading";
    inventoryNote.textContent = "Loading authorized stock...";
    activityContent.textContent = "Loading recent inventory movements...";
    try {
      const response = await (options.getStock ?? getDashboardStock)(context);
      if (!root.isConnected) return;
      const data = response.data;
      const items = data.inventory_items ?? [];
      const count = data.inventory_truncated ? `${items.length}+` : String(items.length);
      const outOfStock = items.filter((item) => item.status === "OUT_OF_STOCK");
      inventoryCount.textContent = inventoryTotal.textContent = count;
      inventoryCountNote.textContent = data.inventory_truncated ? "At least this many" : "Authorized stock products";
      inventoryOut.textContent = data.inventory_truncated ? `${outOfStock.length}+` : String(outOfStock.length);
      inventoryNote.textContent = data.inventory_truncated ? "Based on the first 100 inventory records. Reorder levels and stock valuation are unavailable." : "Reorder levels and stock valuation are unavailable.";
      if (outOfStock.length) {
        inventoryAttention.hidden = false;
        inventoryAttention.innerHTML = `<strong>Needs attention</strong><span>${outOfStock.slice(0, 2).map((item) => escapeHtml(item.product_name)).join(" · ")}${outOfStock.length > 2 ? ` +${outOfStock.length - 2} more` : ""}</span>`;
      } else { inventoryAttention.hidden = true; inventoryAttention.replaceChildren(); }
      activityContent.className = "";
      activityContent.innerHTML = activityRows(data.recent_activity ?? []);
    } catch (error) {
      if (!root.isConnected) return;
      const message = error?.status === 401 ? "Sign in to load inventory." : error?.status === 403 ? "Inventory access is unavailable for this workspace." : "Inventory service unavailable.";
      inventoryCount.textContent = inventoryTotal.textContent = inventoryOut.textContent = "Unavailable";
      inventoryCountNote.textContent = message;
      inventoryNote.textContent = message;
      activityContent.className = "dashboard-inline-state";
      activityContent.textContent = message;
    }
  }

  function loadProfit(range) {
    root.querySelectorAll("[data-profit-range]").forEach((button) => button.classList.toggle("active", button.dataset.profitRange === range));
    const period = dateRange(range);
    profitContext.textContent = range === "daily" ? `For ${new Date(`${period.from}T00:00:00`).toLocaleDateString("en-PK", { dateStyle: "long" })}` : `${new Date(`${period.from}T00:00:00`).toLocaleDateString("en-PK", { day: "numeric", month: "long" })} to ${new Date(`${period.to}T00:00:00`).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" })}`;
    profitContent.innerHTML = '<p class="dashboard-inline-state">Profit reporting is not connected yet.</p>';
  }

  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-profit-open]")) { profitDialog.showModal(); loadProfit("daily"); }
    if (event.target.closest("[data-profit-close]")) profitDialog.close();
    const range = event.target.closest("[data-profit-range]")?.dataset.profitRange;
    if (range) loadProfit(range);
    const period = event.target.closest("[data-sales-period]")?.dataset.salesPeriod;
    if (period) root.querySelectorAll("[data-sales-period]").forEach((button) => { const active = button.dataset.salesPeriod === period; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
    if (event.target.closest("[data-open-workspace]")) globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace"));
  });
  void loadStock();
}

import { icon } from "./icons.js";
import { createWarehouse, getWarehouse, listWarehouses, updateWarehouse } from "./warehouse-api.js";
import { getWorkspaceContext } from "./workspace-context.js";

function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
export function validateWarehouseDraft(input) {
  const name = String(input?.name ?? "").trim();
  const location = String(input?.location ?? "").trim();
  if (!name || name.length > 200) throw new Error("Warehouse name must be 1 to 200 characters.");
  if (location.length > 500) throw new Error("Location must be 500 characters or fewer.");
  return { name, location: location || null };
}
export function warehouseRowsMarkup(rows) {
  return rows.map((row) => `<button class="product-row" type="button" data-warehouse-id="${escapeHtml(row.id)}"><span class="product-avatar">${icon("warehouse", 18)}</span><span class="product-main"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.location || "No location saved")}</small></span>${icon("chevron", 16)}</button>`).join("");
}

export function mountWarehouses(container, options = {}) {
  const context = options.context ?? getWorkspaceContext(options.storage ?? globalThis.sessionStorage);
  let rows = [], nextCursor = null, selected = null;
  container.innerHTML = `<section class="page-heading"><div><p class="eyebrow">Inventory</p><h1>Warehouses</h1><p class="page-intro">View and maintain your business locations.</p></div><button class="button primary" type="button" data-warehouse-new>+ New Warehouse</button></section>
    <section class="surface"><div id="warehouse-results" aria-live="polite"></div><div class="load-more"><button class="button secondary" type="button" data-warehouse-more hidden>Load more</button></div></section>
    <dialog id="warehouse-detail" class="side-dialog"><div id="warehouse-detail-content"></div></dialog>
    <dialog id="warehouse-editor" class="side-dialog"><form id="warehouse-form" class="modal-card"><div class="side-dialog-head"><h2 id="warehouse-editor-title">New Warehouse</h2><button class="icon-button" type="button" data-warehouse-close aria-label="Close">${icon("close")}</button></div><label>Warehouse name<input name="name" maxlength="200" required /></label><label>Location<input name="location" maxlength="500" /></label><p id="warehouse-form-message" class="form-message" role="alert" hidden></p><div class="dialog-actions"><button class="button secondary" type="button" data-warehouse-close>Cancel</button><button class="button primary" type="submit">Save Warehouse</button></div></form></dialog>`;
  const results = container.querySelector("#warehouse-results");
  const more = container.querySelector("[data-warehouse-more]");
  const detail = container.querySelector("#warehouse-detail");
  const detailContent = container.querySelector("#warehouse-detail-content");
  const editor = container.querySelector("#warehouse-editor");
  const form = container.querySelector("#warehouse-form");
  const message = container.querySelector("#warehouse-form-message");

  function render() {
    more.hidden = !nextCursor;
    if (!context) { results.innerHTML = `<div class="empty-state">${icon("building", 26)}<h2>Choose your workspace</h2><p>Connect an authorized organization and branch to load Warehouses.</p><button class="button secondary" type="button" data-open-workspace>Choose workspace</button></div>`; return; }
    results.innerHTML = rows.length ? `<div class="product-list">${warehouseRowsMarkup(rows)}</div>` : `<div class="empty-state">${icon("warehouse", 26)}<h2>No warehouses yet</h2><p>Warehouses for this workspace will appear here.</p></div>`;
  }
  async function load(append = false) {
    if (!context) { render(); return; }
    results.innerHTML = `<div class="loading-state" role="status"><span class="spinner"></span>Loading warehouses...</div>`;
    try {
      const page = await (options.listWarehouses ?? listWarehouses)(context, { limit: 50, ...(append && nextCursor ? { cursor: nextCursor } : {}) });
      rows = append ? [...rows, ...(page.data ?? [])] : page.data ?? [];
      nextCursor = page.next_cursor ?? null;
      render();
    } catch (error) { results.innerHTML = `<div class="empty-state error-state"><h2>Warehouses unavailable</h2><p>${escapeHtml(error?.message ?? "Could not load warehouses.")}</p><button class="button secondary" type="button" data-warehouse-retry>Try again</button></div>`; }
  }
  function openEditor(row = null) {
    selected = row; form.reset(); message.hidden = true;
    form.querySelector("#warehouse-editor-title").textContent = row ? "Edit Warehouse" : "New Warehouse";
    form.elements.name.value = row?.name ?? "";
    form.elements.location.value = row?.location ?? "";
    detail.close(); editor.showModal();
  }
  container.querySelector("[data-warehouse-new]").addEventListener("click", () => openEditor());
  more.addEventListener("click", () => void load(true));
  results.addEventListener("click", async (event) => {
    if (event.target.closest("[data-open-workspace]")) { globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace")); return; }
    if (event.target.closest("[data-warehouse-retry]")) { void load(); return; }
    const row = event.target.closest("[data-warehouse-id]");
    if (!row || !context) return;
    detailContent.innerHTML = `<div class="loading-state">Loading warehouse...</div>`; detail.showModal();
    try {
      const response = await (options.getWarehouse ?? getWarehouse)(context, row.dataset.warehouseId);
      selected = response.data;
      detailContent.innerHTML = `<div class="side-dialog-head"><h2>${escapeHtml(selected.name)}</h2><button class="icon-button" type="button" data-warehouse-detail-close aria-label="Close">${icon("close")}</button></div><dl class="detail-list"><div><dt>Location</dt><dd>${escapeHtml(selected.location || "No location saved")}</dd></div></dl><button class="button primary" type="button" data-warehouse-edit>Edit Warehouse</button>`;
    } catch (error) { detailContent.innerHTML = `<div class="side-dialog-head"><h2>Warehouse unavailable</h2><button class="icon-button" type="button" data-warehouse-detail-close aria-label="Close">${icon("close")}</button></div><p class="form-message">${escapeHtml(error?.message ?? "Could not load warehouse.")}</p>`; }
  });
  detail.addEventListener("click", (event) => { if (event.target.closest("[data-warehouse-detail-close]")) detail.close(); if (event.target.closest("[data-warehouse-edit]")) openEditor(selected); });
  editor.addEventListener("click", (event) => { if (event.target.closest("[data-warehouse-close]")) editor.close(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); if (!context) return;
    message.hidden = true;
    try {
      const input = validateWarehouseDraft({ name: form.elements.name.value, location: form.elements.location.value });
      await (selected ? (options.updateWarehouse ?? updateWarehouse)(context, selected.id, input) : (options.createWarehouse ?? createWarehouse)(context, input));
      editor.close(); selected = null; await load();
    } catch (error) { message.textContent = error?.message ?? "Warehouse could not be saved."; message.hidden = false; }
  });
  void load();
}

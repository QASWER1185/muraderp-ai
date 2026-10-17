import { createVendor, listVendors, updateVendor } from "./vendor-api.js";
import { getWorkspaceContext } from "./workspace-context.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function requiredText(value, label, maxLength) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return normalized;
}

export function validateVendorDraft(input) {
  return {
    name: requiredText(input?.name, "Vendor name", 200),
    phone: requiredText(input?.phone, "Phone", 50),
    city: requiredText(input?.city, "City", 120),
  };
}

export function vendorErrorMessage(error) {
  if (error?.status === 401) return "Sign in to load vendors.";
  if (error?.status === 403) return "You do not have permission to use Vendors for this organization and branch.";
  return error instanceof Error ? error.message : "Vendors could not be loaded.";
}

export function vendorRowsMarkup(vendors) {
  return vendors.map((vendor) => `<tr>
    <td>${escapeHtml(vendor.id)}</td>
    <td><strong>${escapeHtml(vendor.name)}</strong></td>
    <td>${escapeHtml(vendor.phone)}</td>
    <td>${escapeHtml(vendor.city)}</td>
    <td>${escapeHtml(new Date(vendor.updated_at).toLocaleDateString())}</td>
    <td><button class="button secondary compact" type="button" data-vendor-edit="${escapeHtml(vendor.id)}">Edit</button></td>
  </tr>`).join("");
}

function contextMarkup() {
  return `<section id="vendor-panel" aria-live="polite"></section>
  <dialog id="vendor-editor" class="copilot-dialog vendor-dialog">
    <form id="vendor-form" class="vendor-form">
      <div class="section-head vendor-heading"><div><p class="eyebrow">Vendor record</p><h2 id="vendor-editor-title">New vendor</h2></div><button class="icon-button" type="button" data-vendor-close aria-label="Close">&times;</button></div>
      <label>Vendor name<input name="name" maxlength="200" autocomplete="organization" required /></label>
      <label>Phone<input name="phone" maxlength="50" autocomplete="tel" required /></label>
      <label>City<input name="city" maxlength="120" autocomplete="address-level2" required /></label>
      <p id="vendor-form-result" class="form-message" role="alert" hidden></p>
      <div class="dialog-actions"><button class="button secondary" type="button" data-vendor-close>Cancel</button><button id="vendor-save" class="button primary" type="submit">Save vendor</button></div>
    </form>
  </dialog>`;
}

export function mountVendors(container, options = {}) {
  const storage = options.storage ?? globalThis.sessionStorage;
  const context = options.context ?? getWorkspaceContext(storage);
  let vendors = [];
  let nextCursor = null;
  let state = context ? "loading" : "context";
  let loadError = null;
  let loadSequence = 0;

  container.innerHTML = contextMarkup();
  const panel = container.querySelector("#vendor-panel");
  const dialog = container.querySelector("#vendor-editor");
  const form = container.querySelector("#vendor-form");
  const formResult = container.querySelector("#vendor-form-result");
  const saveButton = container.querySelector("#vendor-save");
  const editorTitle = container.querySelector("#vendor-editor-title");

  function renderPanel() {
    if (state === "context") {
      panel.innerHTML = '<div class="card vendor-state"><h2>Choose your business workspace</h2><p class="muted">Connect an authorized organization and branch to load vendors.</p><button class="button primary" type="button" data-open-workspace>Choose workspace</button></div>';
      return;
    }
    const heading = '<div class="section-head"><div><p class="eyebrow">Authorized vendor records</p><h2>Vendors</h2></div></div>';
    const toolbar = `<div class="section-head"><div><p class="eyebrow">Authorized vendor records</p><h2>Vendors</h2></div><div class="vendor-toolbar"><button class="button secondary" type="button" data-vendor-refresh>Refresh</button><button class="button primary" type="button" data-vendor-new>+ New vendor</button></div></div>`;
    if (state === "loading" && vendors.length === 0) {
      panel.innerHTML = `${heading}<div class="card vendor-state" role="status"><span class="vendor-spinner" aria-hidden="true"></span><p>Loading vendors&hellip;</p></div>`;
      return;
    }
    if (state === "error") {
      panel.innerHTML = `${heading}<div class="card vendor-state vendor-error" role="alert"><h3>Vendors unavailable</h3><p>${escapeHtml(vendorErrorMessage(loadError))}</p><button class="button secondary" type="button" data-vendor-retry>Try again</button></div>`;
      return;
    }
    if (vendors.length === 0) {
      panel.innerHTML = `${toolbar}<div class="card vendor-state"><h3>No vendors yet</h3><p class="muted">Create the first vendor for this organization.</p><button class="button primary" type="button" data-vendor-new>Create vendor</button></div>`;
      return;
    }
    panel.innerHTML = `${toolbar}<div class="card table-wrap"><table class="table vendor-table"><thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>City</th><th>Updated</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${vendorRowsMarkup(vendors)}</tbody></table></div>${nextCursor ? '<div class="load-more"><button class="button secondary" type="button" data-vendor-more>Load more</button></div>' : ""}`;
  }

  async function load(reset = true) {
    if (!context) return;
    const sequence = ++loadSequence;
    if (reset) vendors = [];
    state = "loading";
    loadError = null;
    renderPanel();
    try {
      const page = await listVendors(context, { limit: 50, ...(reset || nextCursor === null ? {} : { cursor: nextCursor }) });
      if (sequence !== loadSequence) return;
      vendors = reset ? page.data : [...vendors, ...page.data];
      nextCursor = page.next_cursor;
      state = "ready";
    } catch (error) {
      if (sequence !== loadSequence) return;
      state = "error";
      loadError = error;
    }
    renderPanel();
  }

  function field(name) { return form.elements.namedItem(name); }
  function openEditor(vendor = null) {
    form.reset();
    form.dataset.vendorId = vendor ? String(vendor.id) : "";
    editorTitle.textContent = vendor ? "Edit vendor" : "New vendor";
    field("name").value = vendor?.name ?? "";
    field("phone").value = vendor?.phone ?? "";
    field("city").value = vendor?.city ?? "";
    formResult.hidden = true;
    formResult.textContent = "";
    dialog.showModal();
    field("name").focus();
  }

  panel.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-open-workspace]")) globalThis.dispatchEvent(new Event("muraderp:open-workspace"));
    if (target.matches("[data-vendor-new]")) openEditor();
    if (target.matches("[data-vendor-refresh], [data-vendor-retry]")) void load(true);
    if (target.matches("[data-vendor-more]")) void load(false);
    if (target.matches("[data-vendor-edit]")) {
      const vendor = vendors.find((item) => String(item.id) === target.dataset.vendorEdit);
      if (vendor) openEditor(vendor);
    }
  });

  dialog.querySelectorAll("[data-vendor-close]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!context) return;
    const data = new FormData(form);
    formResult.hidden = true;
    saveButton.disabled = true;
    try {
      const draft = validateVendorDraft({ name: data.get("name"), phone: data.get("phone"), city: data.get("city") });
      const vendorId = form.dataset.vendorId;
      const result = vendorId ? await updateVendor(context, vendorId, draft) : await createVendor(context, draft);
      const saved = result.data;
      const existingIndex = vendors.findIndex((vendor) => vendor.id === saved.id);
      if (existingIndex >= 0) vendors[existingIndex] = saved;
      else vendors = [...vendors, saved].sort((left, right) => left.id - right.id);
      state = "ready";
      dialog.close();
      renderPanel();
    } catch (error) {
      formResult.textContent = vendorErrorMessage(error);
      formResult.hidden = false;
    } finally {
      saveButton.disabled = false;
    }
  });

  renderPanel();
  if (context) void load(true);
}

import { createCustomer, listCustomers, normalizeCustomerContext, updateCustomer } from "./customer-api.js";

const CONTEXT_KEY = "muraderp.customer-context";

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

export function validateCustomerDraft(input) {
  return {
    name: requiredText(input?.name, "Customer name", 200),
    phone: requiredText(input?.phone, "Phone", 50),
    city: requiredText(input?.city, "City", 120),
  };
}

export function customerErrorMessage(error) {
  if (error?.status === 401) return "Sign in to load customers.";
  if (error?.status === 403) return "You do not have permission to use Customers for this organization and branch.";
  return error instanceof Error ? error.message : "Customers could not be loaded.";
}

export function customerRowsMarkup(customers) {
  return customers.map((customer) => `<tr>
    <td>${escapeHtml(customer.id)}</td>
    <td><strong>${escapeHtml(customer.name)}</strong></td>
    <td>${escapeHtml(customer.phone)}</td>
    <td>${escapeHtml(customer.city)}</td>
    <td>${escapeHtml(new Date(customer.updated_at).toLocaleDateString())}</td>
    <td><button class="button secondary compact" type="button" data-customer-edit="${escapeHtml(customer.id)}">Edit</button></td>
  </tr>`).join("");
}

function storedContext(storage) {
  try {
    const value = JSON.parse(storage?.getItem(CONTEXT_KEY) ?? "null");
    return value ? normalizeCustomerContext(value) : null;
  } catch {
    return null;
  }
}

function storeContext(storage, context) {
  try { storage?.setItem(CONTEXT_KEY, JSON.stringify(context)); } catch { /* Session storage is optional. */ }
}

function contextMarkup(context) {
  return `<section class="card customer-context-card">
    <div class="section-head customer-heading"><div><p class="eyebrow">Master data</p><h2>Customer workspace</h2></div></div>
    <p class="muted">Choose your assigned organization and branch. Access is verified by the server before customer data is returned.</p>
    <form id="customer-context-form" class="customer-context-form">
      <label>Organization<input name="organization" value="${escapeHtml(context?.organizationId ?? "")}" placeholder="Organization UUID" autocomplete="off" required /></label>
      <label>Branch<input name="branch" value="${escapeHtml(context?.branchId ?? "")}" placeholder="Branch UUID" autocomplete="off" required /></label>
      <button class="button primary" type="submit">Load customers</button>
    </form>
    <p id="customer-context-result" class="form-message customer-context-message" role="alert" hidden></p>
  </section>
  <section id="customer-panel" aria-live="polite"></section>
  <dialog id="customer-editor" class="copilot-dialog customer-dialog">
    <form id="customer-form" class="customer-form">
      <div class="section-head customer-heading"><div><p class="eyebrow">Customer record</p><h2 id="customer-editor-title">New customer</h2></div><button class="icon-button" type="button" data-customer-close aria-label="Close">×</button></div>
      <label>Customer name<input name="name" maxlength="200" autocomplete="name" required /></label>
      <label>Phone<input name="phone" maxlength="50" autocomplete="tel" required /></label>
      <label>City<input name="city" maxlength="120" autocomplete="address-level2" required /></label>
      <p id="customer-form-result" class="form-message" role="alert" hidden></p>
      <div class="dialog-actions"><button class="button secondary" type="button" data-customer-close>Cancel</button><button id="customer-save" class="button primary" type="submit">Save customer</button></div>
    </form>
  </dialog>`;
}

export function mountCustomers(container, options = {}) {
  const storage = options.storage ?? globalThis.sessionStorage;
  let context = storedContext(storage);
  let customers = [];
  let nextCursor = null;
  let state = context ? "loading" : "context";
  let loadError = null;
  let loadSequence = 0;

  container.innerHTML = contextMarkup(context);
  const contextForm = container.querySelector("#customer-context-form");
  const contextResult = container.querySelector("#customer-context-result");
  const panel = container.querySelector("#customer-panel");
  const dialog = container.querySelector("#customer-editor");
  const form = container.querySelector("#customer-form");
  const formResult = container.querySelector("#customer-form-result");
  const saveButton = container.querySelector("#customer-save");
  const editorTitle = container.querySelector("#customer-editor-title");

  function renderPanel() {
    if (state === "context") {
      panel.innerHTML = '<div class="card customer-state"><h2>Select an organization and branch</h2><p class="muted">Customer records remain hidden until the server verifies your access.</p></div>';
      return;
    }
    const heading = '<div class="section-head"><div><p class="eyebrow">Authorized customer records</p><h2>Customers</h2></div></div>';
    const toolbar = `<div class="section-head"><div><p class="eyebrow">Authorized customer records</p><h2>Customers</h2></div><div class="customer-toolbar"><button class="button secondary" type="button" data-customer-refresh>Refresh</button><button class="button primary" type="button" data-customer-new>+ New customer</button></div></div>`;
    if (state === "loading" && customers.length === 0) {
      panel.innerHTML = `${heading}<div class="card customer-state" role="status"><span class="customer-spinner" aria-hidden="true"></span><p>Loading customers…</p></div>`;
      return;
    }
    if (state === "error") {
      panel.innerHTML = `${heading}<div class="card customer-state customer-error" role="alert"><h3>Customers unavailable</h3><p>${escapeHtml(customerErrorMessage(loadError))}</p><button class="button secondary" type="button" data-customer-retry>Try again</button></div>`;
      return;
    }
    if (customers.length === 0) {
      panel.innerHTML = `${toolbar}<div class="card customer-state"><h3>No customers yet</h3><p class="muted">Create the first customer for this organization.</p><button class="button primary" type="button" data-customer-new>Create customer</button></div>`;
      return;
    }
    panel.innerHTML = `${toolbar}<div class="card table-wrap"><table class="table customer-table"><thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>City</th><th>Updated</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${customerRowsMarkup(customers)}</tbody></table></div>${nextCursor ? '<div class="load-more"><button class="button secondary" type="button" data-customer-more>Load more</button></div>' : ""}`;
  }

  async function load(reset = true) {
    if (!context) return;
    const sequence = ++loadSequence;
    if (reset) customers = [];
    state = "loading";
    loadError = null;
    renderPanel();
    try {
      const page = await listCustomers(context, { limit: 50, ...(reset || nextCursor === null ? {} : { cursor: nextCursor }) });
      if (sequence !== loadSequence) return;
      customers = reset ? page.data : [...customers, ...page.data];
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
  function openEditor(customer = null) {
    form.reset();
    form.dataset.customerId = customer ? String(customer.id) : "";
    editorTitle.textContent = customer ? "Edit customer" : "New customer";
    field("name").value = customer?.name ?? "";
    field("phone").value = customer?.phone ?? "";
    field("city").value = customer?.city ?? "";
    formResult.hidden = true;
    formResult.textContent = "";
    dialog.showModal();
    field("name").focus();
  }

  contextForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(contextForm);
    contextResult.hidden = true;
    contextResult.textContent = "";
    try {
      context = normalizeCustomerContext({ organizationId: data.get("organization"), branchId: data.get("branch") });
      storeContext(storage, context);
      nextCursor = null;
      void load(true);
    } catch (error) {
      contextResult.textContent = error instanceof Error ? error.message : "Select a valid organization and branch.";
      contextResult.hidden = false;
    }
  });

  panel.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-customer-new]")) openEditor();
    if (target.matches("[data-customer-refresh], [data-customer-retry]")) void load(true);
    if (target.matches("[data-customer-more]")) void load(false);
    if (target.matches("[data-customer-edit]")) {
      const customer = customers.find((item) => String(item.id) === target.dataset.customerEdit);
      if (customer) openEditor(customer);
    }
  });

  dialog.querySelectorAll("[data-customer-close]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!context) return;
    const data = new FormData(form);
    formResult.hidden = true;
    saveButton.disabled = true;
    try {
      const draft = validateCustomerDraft({ name: data.get("name"), phone: data.get("phone"), city: data.get("city") });
      const customerId = form.dataset.customerId;
      const result = customerId ? await updateCustomer(context, customerId, draft) : await createCustomer(context, draft);
      const saved = result.data;
      const existingIndex = customers.findIndex((customer) => customer.id === saved.id);
      if (existingIndex >= 0) customers[existingIndex] = saved;
      else customers = [...customers, saved].sort((left, right) => left.id - right.id);
      state = "ready";
      dialog.close();
      renderPanel();
    } catch (error) {
      formResult.textContent = customerErrorMessage(error);
      formResult.hidden = false;
    } finally {
      saveButton.disabled = false;
    }
  });

  renderPanel();
  if (context) void load(true);
}

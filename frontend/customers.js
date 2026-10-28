import { createCustomer, getCustomerCenter, listCustomers, updateCustomer } from "./customer-api.js";
import { getWorkspaceContext } from "./workspace-context.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const money = (value) => Number(value ?? 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = (value) => Number(value ?? 0).toLocaleString("en-PK", { maximumFractionDigits: 0 });
const dateLabel = (value) => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("en-PK") : "—";

export function customerBalanceLabel(value) {
  const balance = Number(value ?? 0);
  if (Math.abs(balance) < 0.005) return { label: "Settled · PKR 0", tone: "settled" };
  return balance > 0
    ? { label: `Receivable: PKR ${money(balance)}`, tone: "receivable" }
    : { label: `Payable / Credit: PKR ${money(Math.abs(balance))}`, tone: "credit" };
}

const searchAliases = [
  ["aamir", "amir", "amer", "عامر"], ["khalid", "khaled", "khaleed", "خالد"],
  ["ikram", "ekram", "akram", "اکرام"], ["aslam", "اسلم"],
  ["muhammad", "mohammad", "mohammed", "muhammed", "محمد"],
  ["sial", "سیال"], ["sahib", "صاحب"], ["majeed", "majid", "مجید"],
];
const normalizeSearch = (value) => String(value ?? "").toLocaleLowerCase()
  .normalize("NFKD").replace(/[\u064B-\u065F\u0670]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").trim();
const urduToLatin = new Map(Object.entries({ "ا":"a","آ":"aa","ب":"b","پ":"p","ت":"t","ٹ":"t","ث":"s","ج":"j","چ":"ch","ح":"h","خ":"kh","د":"d","ڈ":"d","ذ":"z","ر":"r","ڑ":"r","ز":"z","ژ":"zh","س":"s","ش":"sh","ص":"s","ض":"z","ط":"t","ظ":"z","ع":"a","غ":"gh","ف":"f","ق":"q","ک":"k","گ":"g","ل":"l","م":"m","ن":"n","ں":"n","و":"o","ہ":"h","ھ":"h","ء":"","ی":"i","ے":"e" }));
const latinToUrdu = new Map(Object.entries({a:"ا",b:"ب",c:"ک",d:"د",e:"ی",f:"ف",g:"گ",h:"ہ",i:"ی",j:"ج",k:"ک",l:"ل",m:"م",n:"ن",o:"و",p:"پ",q:"ق",r:"ر",s:"س",t:"ت",u:"و",v:"و",w:"و",x:"کس",y:"ی",z:"ز"}));
function searchForms(value) {
  const token = normalizeSearch(value);
  const forms = new Set([token]);
  for (const group of searchAliases) if (group.some((form) => normalizeSearch(form) === token)) for (const form of group) forms.add(normalizeSearch(form));
  if (/[\u0600-\u06FF]/.test(token)) forms.add([...token].map((char) => urduToLatin.get(char) ?? char).join(""));
  else if (/^[a-z]+$/.test(token)) forms.add([...token].map((char) => latinToUrdu.get(char) ?? char).join(""));
  return [...forms].filter(Boolean);
}
export function customerSearchMatches(customer, query) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;
  const name = normalizeSearch(customer.name);
  const phone = String(customer.phone ?? "").replace(/\D/g, "");
  const phoneQuery = String(query).replace(/\D/g, "");
  if (phoneQuery.length >= 2 && phone.includes(phoneQuery)) return true;
  return normalizedQuery.split(/\s+/).every((term) => searchForms(term).some((form) => name.includes(form)));
}

function requiredText(value, label, maxLength) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return normalized;
}

export function validateCustomerDraft(input) {
  const openingBalance = input?.opening_balance === "" || input?.opening_balance == null ? 0 : Number(input.opening_balance);
  if (!Number.isFinite(openingBalance) || Math.abs(openingBalance) > 999999999999) throw new Error("Opening balance must be a valid amount.");
  return {
    name: requiredText(input?.name, "Customer name", 200),
    phone: requiredText(input?.phone, "Phone", 50),
    city: requiredText(input?.address ?? input?.city, "Address", 120),
    opening_balance: openingBalance,
  };
}

export function customerErrorMessage(error) {
  if (error?.status === 401) return "Sign in to load customers.";
  if (error?.status === 403) return "You do not have permission to use Customers for this organization and branch.";
  return error instanceof Error ? error.message : "Customers could not be loaded.";
}

export function customerRowsMarkup(customers) {
  return customers.map((customer) => `<tr>
    <td>${escapeHtml(customer.id)}</td><td><strong>${escapeHtml(customer.name)}</strong></td>
    <td>${escapeHtml(customer.phone)}</td><td>${escapeHtml(customer.city)}</td>
    <td>${escapeHtml(new Date(customer.updated_at).toLocaleDateString())}</td>
    <td><button class="button secondary compact" type="button" data-customer-edit="${escapeHtml(customer.id)}">Edit</button></td>
  </tr>`).join("");
}

function contextMarkup() {
  return `<section id="customer-panel" aria-live="polite"></section>
  <dialog id="customer-editor" class="copilot-dialog customer-dialog">
    <form id="customer-form" class="customer-form">
      <div class="section-head customer-heading"><div><p class="eyebrow">Customer record</p><h2 id="customer-editor-title">New customer</h2></div><button class="icon-button" type="button" data-customer-close aria-label="Close">×</button></div>
      <label>Customer name<input name="name" maxlength="200" autocomplete="name" required /></label>
      <label>Phone<input name="phone" maxlength="50" autocomplete="tel" required /></label>
      <label>Address<input name="city" maxlength="120" autocomplete="street-address" required /></label>
      <label>Opening Balance (PKR)<input name="opening_balance" type="number" step="0.01" value="0" inputmode="decimal" /></label>
      <p id="customer-form-result" class="form-message" role="alert" hidden></p>
      <div class="dialog-actions"><button class="button secondary" type="button" data-customer-close>Cancel</button><button id="customer-save" class="button primary" type="submit">Save customer</button></div>
    </form>
  </dialog>`;
}

function balanceMarkup(value) {
  const item = customerBalanceLabel(value);
  return `<strong class="customer-balance customer-balance-${item.tone}" dir="auto">${escapeHtml(item.label)}</strong>`;
}

function customerRowMarkup(customer, selectedId) {
  const active = String(customer.id) === String(selectedId);
  return `<div class="customer-center-row-wrap"><button class="customer-center-row${active ? " is-selected" : ""}" type="button" data-customer-select="${escapeHtml(customer.id)}" aria-current="${active ? "true" : "false"}">
    <span class="customer-center-row-copy"><strong dir="auto">${escapeHtml(customer.name)}</strong><span>${escapeHtml(customer.phone || "Phone unavailable")} <i aria-hidden="true">•</i> <em>${count(customer.estimates_count)} Estimates</em></span></span>
    ${balanceMarkup(customer.balance)}
  </button><button class="customer-center-row-edit" type="button" data-customer-edit="${escapeHtml(customer.id)}" aria-label="Edit ${escapeHtml(customer.name)}">Edit</button></div>`;
}

function tabButton(name, label, badge, active) {
  return `<button class="customer-ledger-tab${active === name ? " is-active" : ""}" type="button" role="tab" aria-selected="${active === name}" data-center-tab="${name}"><span>${label}</span><b>${count(badge)}</b></button>`;
}

function transactionTable(rows, columns, rowAction = "") {
  if (!rows.length) return `<div class="customer-ledger-empty">No transactions to display.</div>`;
  return `<div class="customer-ledger-table-wrap"><table class="table customer-ledger-table"><thead><tr>${columns.map((column) => `<th>${column.label}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => {
    const cells = columns.map((column) => {
      const raw = column.render ? column.render(row) : escapeHtml(row[column.key]);
      return `<td data-label="${escapeHtml(column.label)}">${raw}</td>`;
    }).join("");
    return `<tr${rowAction ? ` class="customer-transaction-row" data-${rowAction}="${escapeHtml(row.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(row.estimate_number ?? row.invoice_number ?? row.return_number ?? row.payment_number ?? "transaction")}"` : ""}>${cells}</tr>`;
  }).join("")}</tbody></table></div>`;
}

function centerTransactionsMarkup(center, activeTab) {
  const estimates = center.estimates ?? [];
  const invoices = center.invoices ?? [];
  const returns = center.returns ?? [];
  const payments = center.payments ?? [];
  const balance = customerBalanceLabel(center.balance);
  const tabs = `<div class="customer-ledger-tabs" role="tablist" aria-label="Customer transactions">${tabButton("estimates", "Estimates", estimates.length, activeTab)}${tabButton("invoices", "Invoices", invoices.length, activeTab)}${tabButton("returns", "Returns / Credit", returns.length, activeTab)}${tabButton("payments", "Payments / Receipts", payments.length, activeTab)}</div>`;
  if (activeTab === "estimates") {
    return `${tabs}<div class="customer-ledger-section"><div class="customer-ledger-subhead"><strong>${count(estimates.length)} Estimates</strong><b>PKR ${money(estimates.reduce((sum, row) => sum + Number(row.grand_total ?? 0), 0))}</b></div>${transactionTable(estimates, [
      { key: "estimate_number", label: "Estimate No." }, { key: "issue_date", label: "Date", render: (row) => dateLabel(row.issue_date) },
      { key: "grand_total", label: "Grand Total", render: (row) => `PKR ${money(row.grand_total)}` }, { key: "pass_through_rent", label: "Carriage / Delivery", render: (row) => `PKR ${money(row.pass_through_rent)}` }, { key: "status", label: "Status", render: (row) => `<span class="customer-status-badge status-${escapeHtml(String(row.status).toLowerCase())}">${escapeHtml(row.status)}</span>` },
    ], "open-estimate")}</div>`;
  }
  if (activeTab === "invoices") {
    return `${tabs}<div class="customer-ledger-section"><div class="customer-ledger-subhead"><strong>${count(invoices.length)} Invoices</strong><b>PKR ${money(invoices.reduce((sum, row) => sum + Number(row.grand_total ?? 0), 0))}</b></div>${transactionTable(invoices, [
      { key: "invoice_number", label: "Invoice No." }, { key: "issue_date", label: "Date", render: (row) => dateLabel(row.issue_date) },
      { key: "grand_total", label: "Total Amount", render: (row) => `PKR ${money(row.grand_total)}` }, { key: "paid_amount", label: "Paid", render: (row) => `PKR ${money(row.paid_amount)}` },
      { key: "outstanding_amount", label: "Outstanding", render: (row) => `PKR ${money(row.outstanding_amount)}` },
      { key: "status", label: "Status", render: (row) => `<span class="customer-status-badge status-${escapeHtml(String(row.status).toLowerCase())}">${escapeHtml(row.status)}</span>` },
    ], "open-invoice")}</div>`;
  }
  if (activeTab === "returns") {
    return `${tabs}<div class="customer-ledger-section"><div class="customer-ledger-subhead"><strong>Total Returns / Credits</strong><b>PKR ${money(returns.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0))}</b></div>${transactionTable(returns, [
      { key: "return_number", label: "Return No." }, { key: "return_date", label: "Date", render: (row) => dateLabel(row.return_date) }, { key: "total_amount", label: "Amount", render: (row) => `PKR ${money(row.total_amount)}` },
    ], "open-return")}</div>`;
  }
  return `${tabs}<div class="customer-ledger-section"><div class="customer-ledger-subhead"><strong>Total Payments / Receipts</strong><b>PKR ${money(payments.reduce((sum, row) => sum + Number(row.amount ?? 0), 0))}</b></div>${transactionTable(payments, [
    { key: "payment_number", label: "Receipt No." }, { key: "payment_date", label: "Receipt Date", render: (row) => dateLabel(row.payment_date) }, { key: "amount", label: "Amount (PKR)", render: (row) => `PKR ${money(row.amount)}` },
    { key: "payment_method", label: "Payment Method / Reference", render: (row) => `${escapeHtml(String(row.payment_method ?? "OTHER").replaceAll("_", " "))}${row.reference_number ? ` · ${escapeHtml(row.reference_number)}` : ""}` },
  ], "open-payment")}</div>`;
}

function detailMarkup(center, state, activeTab) {
  if (state === "empty") return `<div class="customer-center-empty"><span class="customer-center-empty-icon">↖</span><h2>Select a customer</h2><p>View balances and transaction details here.</p></div>`;
  if (state === "loading") return `<div class="customer-center-empty" role="status"><span class="customer-spinner" aria-hidden="true"></span><p>Loading customer account…</p></div>`;
  if (state === "error") return `<div class="customer-center-empty" role="alert"><h2>Account could not be loaded</h2><p>${escapeHtml(center?.message || "Please try again.")}</p><button type="button" class="button secondary" data-center-retry>Try again</button></div>`;
  const customer = center.customer ?? {};
  const balance = customerBalanceLabel(center.balance);
  return `<header class="customer-ledger-header"><div class="customer-ledger-title-row"><button class="button secondary customer-center-back" type="button" data-center-back>← Back to Customers</button><div><p class="eyebrow">CUSTOMER CENTER</p><h2 dir="auto">${escapeHtml(customer.name)}</h2><p class="customer-ledger-contact"><span>${escapeHtml(customer.phone || "Phone unavailable")}</span><span dir="auto">${escapeHtml(customer.address || customer.city || "Address unavailable")}</span></p></div><button class="button secondary" type="button" data-customer-edit="${escapeHtml(customer.id)}">Edit Customer</button></div>
    <div class="customer-ledger-actions"><button class="button primary" type="button" data-center-new-estimate="${escapeHtml(customer.id)}">+ New Estimate</button><button class="button secondary" type="button" data-center-new-invoice>+ New Invoice</button></div></header>
    <div class="customer-center-kpis"><article class="customer-center-kpi customer-center-kpi-balance"><span>Net Balance</span><strong class="customer-balance-${balance.tone}" dir="auto">${escapeHtml(balance.label)}</strong><small>Opening balance + posted invoices − payments − returns</small></article>
      <article class="customer-center-kpi"><span>Total Estimates</span><strong>${count(center.estimates_count)} active / ${count((center.estimates ?? []).length)} total</strong><small>Quote history · PKR ${money(center.estimates_total_amount)}</small></article>
      <article class="customer-center-kpi"><span>Total Invoices</span><strong>PKR ${money(center.invoices_total_amount)}</strong><small>Posted invoices only</small></article>
      <article class="customer-center-kpi"><span>Total Payments</span><strong>PKR ${money(center.payments_total_amount)}</strong><small>Payments received</small></article></div>
    <section class="customer-ledger" aria-label="Customer transaction ledger">${centerTransactionsMarkup(center, activeTab)}</section>`;
}

export function mountCustomers(container, options = {}) {
  const storage = options.storage ?? globalThis.sessionStorage;
  const context = options.context ?? getWorkspaceContext(storage);
  let customers = [];
  let selectedCustomerId = null;
  let center = null;
  let centerState = "empty";
  let activeTab = "estimates";
  let searchTerm = "";
  let balanceFilter = "all";
  let balanceSort = "none";
  let state = context ? "loading" : "context";
  let loadError = null;
  let loadSequence = 0;
  let centerSequence = 0;

  container.innerHTML = contextMarkup();
  const panel = container.querySelector("#customer-panel");
  const dialog = container.querySelector("#customer-editor");
  const form = container.querySelector("#customer-form");
  const formResult = container.querySelector("#customer-form-result");
  const saveButton = container.querySelector("#customer-save");
  const editorTitle = container.querySelector("#customer-editor-title");

  function renderPanel() {
    if (state === "context") {
      panel.innerHTML = '<div class="card customer-state"><h2>Choose your business workspace</h2><p class="muted">Connect an authorized organization and branch to load customers.</p><button class="button primary" type="button" data-open-workspace>Choose workspace</button></div>';
      return;
    }
    panel.innerHTML = `<section class="customer-center-page"><div class="customer-center-heading"><div><p class="eyebrow">CUSTOMER ACCOUNTS</p><h1>Customers</h1><p class="muted">Customer balances come from posted sales, payments, and returns.</p></div><div class="customer-toolbar"><button class="button secondary" type="button" data-customer-refresh>Refresh</button><button class="button primary" type="button" data-customer-new>+ New customer</button></div></div>
      ${state === "loading" && customers.length === 0 ? '<div class="card customer-state" role="status"><span class="customer-spinner" aria-hidden="true"></span><p>Loading customers…</p></div>' : state === "error" ? `<div class="card customer-state customer-error" role="alert"><h3>Customers unavailable</h3><p>${escapeHtml(customerErrorMessage(loadError))}</p><button class="button secondary" type="button" data-customer-retry>Try again</button></div>` : `<div class="customer-center-split"><section class="customer-master-pane" aria-label="Customer list"><div class="customer-master-toolbar"><label class="customer-filter-select">Filter<select id="customer-balance-filter"><option value="all">All Customers</option><option value="open">Open Balance Only</option></select></label><label class="customer-search-label"><span class="sr-only">Search Customers</span><input id="customer-search" type="search" placeholder="Search Customers" value="${escapeHtml(searchTerm)}" autocomplete="off"></label><button class="button secondary customer-sort-button" type="button" data-sort-balance aria-pressed="${balanceSort !== "none"}">Sort by Balance${balanceSort === "desc" ? " ↓" : balanceSort === "asc" ? " ↑" : ""}</button></div><p class="customer-master-count" id="customer-master-count"></p><div class="customer-center-list" id="customer-center-list"></div></section><section class="customer-detail-pane${selectedCustomerId !== null ? " is-detail" : ""}" id="customer-detail-pane" aria-label="Customer account detail"></section></div>`}</section>`;
    const search = panel.querySelector("#customer-search");
    const filter = panel.querySelector("#customer-balance-filter");
    if (search) search.value = searchTerm;
    if (filter) filter.value = balanceFilter;
    renderList();
    renderDetail();
  }

  function renderList() {
    const list = panel.querySelector("#customer-center-list");
    const countNode = panel.querySelector("#customer-master-count");
    if (!list || !countNode) return;
    const term = searchTerm.trim().toLocaleLowerCase();
    const filtered = customers.filter((customer) => {
      if (term && !customerSearchMatches(customer, term)) return false;
      if (balanceFilter === "open" && Number(customer.balance ?? 0) <= 0.004) return false;
      return true;
    });
    if (balanceSort !== "none") filtered.sort((a, b) => (Number(b.balance ?? 0) - Number(a.balance ?? 0)) * (balanceSort === "desc" ? 1 : -1) || Number(a.id) - Number(b.id));
    countNode.textContent = `${count(filtered.length)} Customers`;
    list.innerHTML = filtered.length
      ? filtered.map((customer) => customerRowMarkup(customer, selectedCustomerId)).join("")
      : `<div class="customer-list-empty">${customers.length ? "No matching customers." : "No customers yet. Create the first customer."}</div>`;
  }

  function renderDetail() {
    const detail = panel.querySelector("#customer-detail-pane");
    if (!detail) return;
    detail.innerHTML = detailMarkup(center, centerState, activeTab);
  }

  async function load(reset = true) {
    if (!context) return;
    const sequence = ++loadSequence;
    state = "loading";
    loadError = null;
    if (reset) customers = [];
    renderPanel();
    try {
      let all = [];
      let cursor = null;
      do {
        const page = await listCustomers(context, { limit: 100, ...(cursor ? { cursor } : {}) });
        all = all.concat(page.data ?? []);
        cursor = page.next_cursor;
      } while (cursor && sequence === loadSequence);
      if (sequence !== loadSequence) return;
      customers = all;
      state = "ready";
    } catch (error) {
      if (sequence !== loadSequence) return;
      state = "error";
      loadError = error;
    }
    renderPanel();
    if (selectedCustomerId !== null) void loadCenter(selectedCustomerId);
  }

  async function loadCenter(id) {
    if (!context) return;
    selectedCustomerId = Number(id);
    center = null;
    centerState = "loading";
    const sequence = ++centerSequence;
    renderList();
    renderPanelClass();
    renderDetail();
    try {
      const response = await getCustomerCenter(context, id);
      if (sequence !== centerSequence) return;
      center = response.data;
      centerState = "ready";
    } catch (error) {
      if (sequence !== centerSequence) return;
      centerState = "error";
      center = { message: customerErrorMessage(error) };
    }
    renderDetail();
    renderPanelClass();
  }

  function renderPanelClass() {
    const split = panel.querySelector(".customer-center-split");
    split?.classList.toggle("is-detail", selectedCustomerId !== null);
  }

  function field(name) { return form.elements.namedItem(name); }
  function openEditor(customer = null) {
    form.reset();
    form.dataset.customerId = customer ? String(customer.id) : "";
    editorTitle.textContent = customer ? "Edit customer" : "New customer";
    field("name").value = customer?.name ?? "";
    field("phone").value = customer?.phone ?? "";
    field("city").value = customer?.city ?? "";
    field("opening_balance").value = String(customer?.opening_balance ?? 0);
    formResult.hidden = true;
    formResult.textContent = "";
    dialog.showModal();
    field("name").focus();
  }
  container.addEventListener("muraderp:customer-new", () => openEditor());

  panel.addEventListener("input", (event) => {
    if (event.target.matches("#customer-search")) { searchTerm = event.target.value; renderList(); }
  });
  panel.addEventListener("keydown", (event) => {
    if (!(["Enter", " "].includes(event.key))) return;
    const row = event.target.closest("tr[data-open-estimate], tr[data-open-invoice], tr[data-open-return], tr[data-open-payment]");
    if (!row) return;
    event.preventDefault();
    openTransaction(row);
  });
  panel.addEventListener("change", (event) => {
    if (event.target.matches("#customer-balance-filter")) { balanceFilter = event.target.value; renderList(); }
  });

  function openTransaction(row) {
    if (row.matches("[data-open-estimate]")) globalThis.location.hash = `#/estimates/${encodeURIComponent(row.dataset.openEstimate)}`;
    else if (row.matches("[data-open-invoice]")) globalThis.location.hash = `#/invoices/${encodeURIComponent(row.dataset.openInvoice)}`;
    else if (row.matches("[data-open-return]")) globalThis.location.hash = `#/returns/${encodeURIComponent(row.dataset.openReturn)}`;
    else if (row.matches("[data-open-payment]")) globalThis.location.hash = `#/payments/${encodeURIComponent(row.dataset.openPayment)}`;
  }

  panel.addEventListener("click", (event) => {
    const transactionRow = event.target.closest("tr[data-open-estimate], tr[data-open-invoice], tr[data-open-return], tr[data-open-payment]");
    if (transactionRow) { openTransaction(transactionRow); return; }
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-open-workspace]")) globalThis.dispatchEvent(new Event("muraderp:open-workspace"));
    if (target.matches("[data-customer-new]")) openEditor();
    if (target.matches("[data-customer-refresh], [data-customer-retry]")) void load(true);
    if (target.matches("[data-customer-select]")) { void loadCenter(target.dataset.customerSelect); return; }
    if (target.matches("[data-center-back]")) {
      selectedCustomerId = null; center = null; centerState = "empty"; centerSequence += 1; renderPanelClass(); renderList(); renderDetail(); return;
    }
    if (target.matches("[data-center-retry]")) { if (selectedCustomerId !== null) void loadCenter(selectedCustomerId); return; }
    if (target.matches("[data-center-tab]")) { activeTab = target.dataset.centerTab; renderDetail(); return; }
    if (target.matches("[data-sort-balance]")) { balanceSort = balanceSort === "none" || balanceSort === "asc" ? "desc" : "asc"; renderPanel(); return; }
    if (target.matches("[data-customer-edit]")) {
      const customer = customers.find((item) => String(item.id) === target.dataset.customerEdit) ?? center?.customer;
      if (customer) openEditor(customer);
      return;
    }
    if (target.matches("[data-center-new-estimate]")) {
      globalThis.location.hash = `#/estimates/create/customer/${encodeURIComponent(target.dataset.centerNewEstimate)}`;
      return;
    }
    if (target.matches("[data-center-new-invoice]")) {
      globalThis.addEventListener("hashchange", () => panel.ownerDocument.querySelector("#content [data-invoice-new]")?.click(), { once: true });
      globalThis.location.hash = "#/invoices";
      return;
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
      const draft = validateCustomerDraft({ name: data.get("name"), phone: data.get("phone"), address: data.get("city"), opening_balance: data.get("opening_balance") });
      const customerId = form.dataset.customerId;
      const result = customerId ? await updateCustomer(context, customerId, draft) : await createCustomer(context, draft);
      const saved = result.data;
      dialog.close();
      if (selectedCustomerId !== null && String(selectedCustomerId) === String(saved.id)) {
        center = null; centerState = "loading";
      }
      void load(true);
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

import { icon } from "./icons.js";
import { getJournalEntry, listAccountLedger, listAccounts, listJournalEntries } from "./accounting-api.js";
import { getWorkspaceContext } from "./workspace-context.js";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const money = (value) => Number(value ?? 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function accountingErrorMessage(error) {
  if (error?.status === 401) return "Sign in to view accounting.";
  if (error?.status === 403) return "You do not have permission to view accounting in this branch.";
  return error instanceof Error ? error.message : "Accounting could not be loaded.";
}

export function accountsMarkup(accounts) {
  if (!accounts.length) return `<div class="empty-state"><h2>No accounts found</h2></div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Balance side</th></tr></thead><tbody>${accounts.map((account) => `<tr><td>${escapeHtml(account.code)}</td><td><button class="button secondary" type="button" data-account-id="${escapeHtml(account.id)}">${escapeHtml(account.name)}</button></td><td>${escapeHtml(account.account_type)}</td><td>${escapeHtml(account.normal_balance)}</td></tr>`).join("")}</tbody></table></div>`;
}

export function entriesMarkup(entries) {
  if (!entries.length) return `<div class="empty-state">${icon("receipt", 26)}<h2>No journal entries for this branch</h2><p>Posted business transactions will appear here.</p></div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Journal</th><th>Source</th><th>Status</th></tr></thead><tbody>${entries.map((entry) => `<tr><td>${escapeHtml(entry.entry_date)}</td><td><button class="button secondary" type="button" data-entry-id="${escapeHtml(entry.id)}">${escapeHtml(entry.description)}</button></td><td>${escapeHtml(entry.source_type)} #${escapeHtml(entry.source_record_id)}</td><td>${escapeHtml(entry.status)}</td></tr>`).join("")}</tbody></table></div>`;
}

export function entryMarkup(entry) {
  const lines = entry.lines ?? [];
  const debit = lines.reduce((sum, line) => sum + Number(line.debit), 0);
  const credit = lines.reduce((sum, line) => sum + Number(line.credit), 0);
  return `<h3>${escapeHtml(entry.description)}</h3><p>${escapeHtml(entry.entry_date)} · ${escapeHtml(entry.source_type)} #${escapeHtml(entry.source_record_id)} · ${escapeHtml(entry.status)}</p><div class="table-wrap"><table class="table"><thead><tr><th>Account</th><th>Memo</th><th>Debit</th><th>Credit</th></tr></thead><tbody>${lines.map((line) => `<tr><td>${escapeHtml(line.accounts?.code ?? "")} ${escapeHtml(line.accounts?.name ?? line.account_id)}</td><td>${escapeHtml(line.memo ?? "")}</td><td>${money(line.debit)}</td><td>${money(line.credit)}</td></tr>`).join("")}</tbody><tfoot><tr><th colspan="2">Total</th><th>${money(debit)}</th><th>${money(credit)}</th></tr></tfoot></table></div>`;
}

export function ledgerMarkup(account, rows) {
  return `<h3>${escapeHtml(account.code)} ${escapeHtml(account.name)}</h3>${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Transaction</th><th>Debit</th><th>Credit</th></tr></thead><tbody>${rows.map((line) => `<tr><td>${escapeHtml(line.journal_entries?.entry_date)}</td><td>${escapeHtml(line.journal_entries?.description)}<small>${escapeHtml(line.journal_entries?.source_type)} #${escapeHtml(line.journal_entries?.source_record_id)}</small></td><td>${money(line.debit)}</td><td>${money(line.credit)}</td></tr>`).join("")}</tbody></table></div>` : `<p>No posted journal lines for this account in this branch.</p>`}`;
}

export function mountAccounting(container, options = {}) {
  const context = options.context ?? getWorkspaceContext(options.storage ?? globalThis.sessionStorage);
  let entries = [];
  let entryOffset = null;
  let ledgerRows = [];
  let ledgerOffset = null;
  let selectedAccount = null;
  container.innerHTML = `<section class="page-heading"><div><p class="eyebrow">Finance</p><h1>Accounting</h1><p class="page-intro">Read-only journal and account history for the selected branch.</p></div><button class="button secondary" type="button" data-accounting-refresh>Refresh</button></section><section class="surface"><div class="section-head"><h2>Journal register</h2></div><div id="accounting-entries" aria-live="polite"></div><button class="button secondary" type="button" data-more-entries hidden>Load more entries</button></section><section class="surface"><div class="section-head"><h2>Journal detail</h2></div><div id="accounting-detail" aria-live="polite"><p>Select an entry to view its lines.</p></div></section><section class="surface"><div class="section-head"><h2>Chart of accounts</h2></div><div id="accounting-accounts" aria-live="polite"></div></section><section class="surface"><div class="section-head"><h2>Account ledger</h2></div><div id="accounting-ledger" aria-live="polite"><p>Select an account to view posted transactions.</p></div><button class="button secondary" type="button" data-more-ledger hidden>Load more ledger lines</button></section>`;
  const entriesNode = container.querySelector("#accounting-entries");
  const detailNode = container.querySelector("#accounting-detail");
  const accountsNode = container.querySelector("#accounting-accounts");
  const ledgerNode = container.querySelector("#accounting-ledger");
  const moreEntries = container.querySelector("[data-more-entries]");
  const moreLedger = container.querySelector("[data-more-ledger]");

  async function load(append = false) {
    if (!context) {
      entriesNode.innerHTML = `<div class="empty-state"><h2>Choose your workspace</h2><p>Choose an authorized business and branch to view accounting.</p><button class="button secondary" type="button" data-open-workspace>Choose workspace</button></div>`;
      accountsNode.replaceChildren(); return;
    }
    if (!append) { entriesNode.textContent = "Loading journals..."; accountsNode.textContent = "Loading accounts..."; }
    try {
      const [entryPage, accountPage] = await Promise.all([listJournalEntries(context, { offset: append ? entryOffset : 0 }), append ? null : listAccounts(context)]);
      entries = append ? [...entries, ...entryPage.data] : entryPage.data;
      entryOffset = entryPage.next_offset;
      entriesNode.innerHTML = entriesMarkup(entries);
      moreEntries.hidden = entryOffset == null;
      if (accountPage) accountsNode.innerHTML = accountsMarkup(accountPage.data);
    } catch (error) {
      entriesNode.innerHTML = `<div class="empty-state error-state"><h2>Accounting unavailable</h2><p>${escapeHtml(accountingErrorMessage(error))}</p></div>`;
      accountsNode.replaceChildren();
    }
  }

  async function showEntry(id) {
    detailNode.textContent = "Loading journal lines...";
    try { detailNode.innerHTML = entryMarkup((await getJournalEntry(context, id)).data); }
    catch (error) { detailNode.textContent = accountingErrorMessage(error); }
  }

  async function showLedger(id, append = false) {
    if (!append) ledgerNode.textContent = "Loading account ledger...";
    try {
      const page = await listAccountLedger(context, id, { offset: append ? ledgerOffset : 0 });
      selectedAccount = id;
      ledgerRows = append ? [...ledgerRows, ...page.data] : page.data;
      ledgerOffset = page.next_offset;
      ledgerNode.innerHTML = ledgerMarkup(page.account, ledgerRows);
      moreLedger.hidden = ledgerOffset == null;
    } catch (error) { ledgerNode.textContent = accountingErrorMessage(error); moreLedger.hidden = true; }
  }

  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-open-workspace]")) globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace"));
    if (event.target.closest("[data-accounting-refresh]")) void load();
    if (event.target.closest("[data-more-entries]") && entryOffset != null) void load(true);
    const entry = event.target.closest("[data-entry-id]");
    if (entry) void showEntry(entry.dataset.entryId);
    const account = event.target.closest("[data-account-id]");
    if (account) void showLedger(account.dataset.accountId);
    if (event.target.closest("[data-more-ledger]") && selectedAccount && ledgerOffset != null) void showLedger(selectedAccount, true);
  });
  void load();
}

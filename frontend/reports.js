import { getFinancialSummary, getReportHead, getReportOverview, getTrialBalance } from "./reports-api.js";
import { getWorkspaceContext } from "./workspace-context.js";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const money = (value) => Number(value ?? 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function reportsErrorMessage(error) {
  if (error?.status === 401) return "Sign in to view reports.";
  if (error?.status === 403) return "You do not have permission to view reports in this branch.";
  return error instanceof Error ? error.message : "Reports could not be loaded.";
}

export function summaryMarkup(summary) {
  const items = [
    ["Total debits", summary.totalDebits], ["Total credits", summary.totalCredits],
    ["Net income", summary.netIncome], ["Receivables", summary.receivables],
    ["Payables", summary.payables], ["Cash and bank", summary.cashAndBank],
  ];
  return `<div class="metric-grid">${items.map(([label, value]) => `<div class="metric-card"><div><p>${escapeHtml(label)}</p><strong>${money(value)}</strong></div></div>`).join("")}</div>`;
}

export function trialBalanceMarkup(rows) {
  if (!rows.length) return `<p>No accounts available for this report.</p>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Debit</th><th>Credit</th><th>Net</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.code)}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.account_type)}</td><td>${money(row.total_debit)}</td><td>${money(row.total_credit)}</td><td>${money(row.net_balance)}</td></tr>`).join("")}</tbody></table></div>`;
}

export function mountReports(container, options = {}) {
  const context = options.context ?? getWorkspaceContext(options.storage ?? globalThis.sessionStorage);
  const today = new Date().toISOString().slice(0, 10);
  const from = `${today.slice(0, 8)}01`;
  container.innerHTML = `<section class="page-heading"><div><p class="eyebrow">Finance</p><h1>Reports</h1><p class="page-intro">Read-only financial reports from posted entries in the selected branch.</p></div></section><section class="surface"><div class="section-head"><h2>Reporting period</h2></div><form id="reports-period" class="customer-context-form"><label>From<input type="date" name="from" value="${from}" required></label><label>To<input type="date" name="to" value="${today}" required></label><button class="button primary" type="submit">Run report</button></form><p id="reports-status" role="status" aria-live="polite"></p></section><section class="surface"><div class="section-head"><h2>Financial summary</h2></div><div id="reports-summary"><p>Run a report to view figures.</p></div></section><section class="surface"><div class="section-head"><h2>Report heads</h2></div><div id="reports-heads" aria-live="polite"></div><div id="reports-head-detail" aria-live="polite"></div></section><section class="surface"><div class="section-head"><h2>Trial balance</h2></div><p class="muted">Account totals through the report end date.</p><div id="reports-trial"><p>Run a report to view account totals.</p></div></section>`;
  const form = container.querySelector("#reports-period");
  const status = container.querySelector("#reports-status");
  const summary = container.querySelector("#reports-summary");
  const heads = container.querySelector("#reports-heads");
  const headDetail = container.querySelector("#reports-head-detail");
  const trial = container.querySelector("#reports-trial");
  if (!context) {
    status.innerHTML = `Choose an authorized business and branch. <button class="button secondary" type="button" data-open-workspace>Choose workspace</button>`;
    return;
  }

  getReportOverview(context).then((response) => {
    heads.innerHTML = response.data.heads.map((head) => `<button class="button secondary" type="button" data-report-head="${escapeHtml(head.key)}">${escapeHtml(head.label)}</button>`).join(" ");
  }).catch((error) => { heads.textContent = reportsErrorMessage(error); });

  function period() { return { from: form.elements.from.value, to: form.elements.to.value }; }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selected = period();
    if (selected.from > selected.to) { status.textContent = "From date must not exceed to date."; return; }
    status.textContent = "Loading verified report...";
    try {
      const [financial, balances] = await Promise.all([getFinancialSummary(context, selected), getTrialBalance(context, selected)]);
      summary.innerHTML = summaryMarkup(financial.data);
      trial.innerHTML = trialBalanceMarkup(balances.data);
      status.textContent = `Report loaded for ${selected.from} to ${selected.to}.`;
    } catch (error) { status.textContent = reportsErrorMessage(error); }
  });
  container.addEventListener("click", async (event) => {
    if (event.target.closest("[data-open-workspace]")) globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace"));
    const head = event.target.closest("[data-report-head]")?.dataset.reportHead;
    if (!head) return;
    headDetail.textContent = "Loading report detail...";
    try {
      const result = (await getReportHead(context, head, period())).data;
      headDetail.innerHTML = `<p><strong>${escapeHtml(result.label)}:</strong> ${money(result.value)} <small>${escapeHtml(result.period.from)} to ${escapeHtml(result.period.to)}</small></p>`;
    } catch (error) { headDetail.textContent = reportsErrorMessage(error); }
  });
}

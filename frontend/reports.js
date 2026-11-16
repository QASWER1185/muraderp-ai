import { reportPeriod, periodPills } from "./report-period.js";
import { operationsMarkup, operationsCsv } from "./operations-reports.js";
import { getOperationsReport } from "./reports-api.js";
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
  const { from, to: today } = reportPeriod("monthly");
  container.innerHTML = `<section class="page-heading"><div><p class="eyebrow">Finance</p><h1>Reports</h1><p class="page-intro">Read-only financial reports from posted entries in the selected branch.</p></div></section><section class="surface"><div class="section-head"><h2>Reporting period</h2></div>${periodPills("data-report-period")}<form id="reports-period" class="customer-context-form"><label>Period<select name="preset"><option value="daily">Today</option><option value="weekly">This week</option><option value="monthly" selected>This month</option><option value="custom">Custom (From/To)</option></select></label><label>From<input type="date" name="from" value="${from}" required></label><label>To<input type="date" name="to" value="${today}" required></label><label>Product<select name="productId"><option value="">Choose product</option></select></label><button class="button primary" type="submit">Run report</button></form><p id="reports-status" role="status" aria-live="polite"></p></section><section class="surface"><div class="section-head"><h2>Sales, stock and profit</h2></div><div id="reports-operations" aria-live="polite">Run a report to view daily breakdowns.</div></section><section class="surface"><div class="section-head"><h2>Financial summary</h2></div><div id="reports-summary"><p>Run a report to view figures.</p></div></section><section class="surface"><div class="section-head"><h2>Report heads</h2></div><div id="reports-heads" aria-live="polite"></div><div id="reports-head-detail" aria-live="polite"></div></section><section class="surface"><div class="section-head"><h2>Trial balance</h2></div><p class="muted">Cumulative account totals through the report end date. Revenue and COGS reconciliation above uses only the selected period.</p><div id="reports-trial"><p>Run a report to view account totals.</p></div></section>`;
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

  let latestReport, generation = 0;
  const operations = container.querySelector("#reports-operations");
  function period() { return { from: form.elements.from.value, to: form.elements.to.value }; }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selected = period();
    if (selected.from > selected.to) { status.textContent = "From date must not exceed to date."; return; }
    const current = ++generation;
    latestReport = null;
    operations.textContent = "Loading daily sales, stock and profit...";
    headDetail.textContent = "";
    status.textContent = "Loading verified report...";
    try {
      const [financial, balances, report] = await Promise.all([getFinancialSummary(context, selected), getTrialBalance(context, selected), getOperationsReport(context, selected, form.elements.productId.value)]);
      if (current !== generation) return;
      latestReport = report.data;
      operations.innerHTML = operationsMarkup(report.data);
      const picker = form.elements.productId, chosen = picker.value;
      picker.innerHTML = `<option value="">Choose product</option>${report.data.products.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} · ${escapeHtml(p.unit)}</option>`).join("")}`;
      picker.value = chosen;
      summary.innerHTML = `<p>${escapeHtml(selected.from)} to ${escapeHtml(selected.to)}: debits, credits and net income. Balances cumulative through ${escapeHtml(selected.to)}.</p>` + summaryMarkup(financial.data);
      trial.innerHTML = `<p>As of ${escapeHtml(selected.to)} (cumulative)</p>` + trialBalanceMarkup(balances.data);
      status.textContent = `Report loaded for ${selected.from} to ${selected.to}.`;
    } catch (error) { if (current !== generation) return; operations.textContent = reportsErrorMessage(error); summary.textContent = "Report unavailable for this period."; trial.textContent = "Report unavailable for this period."; status.textContent = reportsErrorMessage(error); }
  });
  form.addEventListener("change", event => {
    if (event.target.name === "preset" && event.target.value !== "custom") { const p = reportPeriod(event.target.value); form.elements.from.value = p.from; form.elements.to.value = p.to; }
    if (["from", "to"].includes(event.target.name)) form.elements.preset.value = "custom";
    container.querySelectorAll("[data-report-period]").forEach(b => { const active = b.dataset.reportPeriod === form.elements.preset.value; b.classList.toggle("active", active); b.setAttribute("aria-pressed", String(active)); });
    if (["preset", "productId"].includes(event.target.name)) form.requestSubmit();
  });
  container.addEventListener("click", async (event) => {
    const preset = event.target.closest("[data-report-period]")?.dataset.reportPeriod;
    if (preset) { form.elements.preset.value = preset; form.elements.preset.dispatchEvent(new Event("change", { bubbles: true })); return; }
    if (event.target.closest("[data-report-export]") && latestReport) {
      const url = URL.createObjectURL(new Blob([operationsCsv(latestReport)], { type: "text/csv;charset=utf-8" })), a = document.createElement("a");
      a.href = url; a.download = "sales-stock-profit-" + latestReport.period.from + "-to-" + latestReport.period.to + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
    }
    if (event.target.closest("[data-open-workspace]")) globalThis.dispatchEvent(new CustomEvent("muraderp:open-workspace"));
    const head = event.target.closest("[data-report-head]")?.dataset.reportHead;
    if (!head) return;
    const selectedPeriod = period();
    if (selectedPeriod.from > selectedPeriod.to) { headDetail.textContent = "From date must not exceed to date."; return; }
    headDetail.textContent = "Loading report detail...";
    try {
      const result = (await getReportHead(context, head, selectedPeriod)).data;
      headDetail.innerHTML = `<p><strong>${escapeHtml(result.label)}:</strong> ${money(result.value)} <small>${["receivables", "payables"].includes(head) ? "Cumulative as of " + escapeHtml(result.period.to) : escapeHtml(result.period.from) + " to " + escapeHtml(result.period.to)}</small></p>`;
    } catch (error) { headDetail.textContent = reportsErrorMessage(error); }
  });
  form.requestSubmit();
}

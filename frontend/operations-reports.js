const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const number = value => Number(value ?? 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
function table(columns, rows, totals) {
  const cells = row => columns.map(([key, label, text]) => `<td>${text ? escape(row[key]) : number(row[key])}</td>`).join("");
  return `<div class="table-wrap"><table class="table"><thead><tr>${columns.map(([, label]) => `<th>${escape(label)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${cells(row)}</tr>`).join("")}</tbody>${totals ? `<tfoot><tr>${cells(totals)}</tr></tfoot>` : ""}</table></div>`;
}
const salesColumns = [["date", "Date", true], ["invoicesCount", "Invoices Count"], ["quantitySold", "Quantity Sold"], ["grossSales", "Gross Sales"], ["returns", "Returns"], ["netSales", "Net Sales"]];
const productColumns = [["date", "Date", true], ["openingStock", "Opening Stock"], ["purchased", "Qty Purchased"], ["sold", "Qty Sold"], ["returned", "Qty Returned"], ["adjustments", "Adjustments"], ["closingStock", "Closing Stock"], ["salesValue", "Sales Value"], ["cogs", "Cost (COGS)"], ["profit", "Profit"]];
const profitColumns = [["name", "Product", true], ["revenue", "Revenue"], ["cogs", "Cost of Goods Sold (COGS)"], ["grossProfit", "Gross Profit"]];
export function operationsMarkup(report) {
  const range = `${escape(report.period.from)} to ${escape(report.period.to)}`, totalSales = { ...report.sales.totals, date: "Period total" };
  const rollup = rows => table(salesColumns, rows.map(r => ({ ...r, date: `${r.from} to ${r.to}` })));
  const reconciliation = report.profit.reconciliation;
  return `<p><strong>${range} · ${escape(report.currency)}</strong></p><h3>Daily sales</h3><p>${escape(report.footnote)}</p>${table(salesColumns, report.sales.daily, totalSales)}<details><summary>Week rollups</summary>${rollup(report.sales.weekly)}</details><details><summary>Month rollups</summary>${rollup(report.sales.monthly)}</details><h3>Product stock and profit</h3><p>${escape(report.stockScope)}. Opening + Purchased - Sold + Returned +/- Adjustments = Closing.</p>${report.product ? `<h4>${escape(report.product.name)} · ${escape(report.product.unit)}</h4>${table(productColumns, report.product.daily, { ...report.product.totals, date: "Period total" })}` : "<p>Choose a product to view its daily stock and profit breakdown.</p>"}<h3>Profit by product</h3><p>${range}. Historical movement / purchase unit cost; fallback to product purchase price. Returns reverse revenue and cost.</p>${table(profitColumns, report.profit.rows, { ...report.profit.totals, name: "Grand total" })}<h4>Trial balance reconciliation · periodic Sales Revenue and COGS</h4><p>Ledger Revenue: ${number(reconciliation.ledgerRevenue)} · Ledger COGS: ${number(reconciliation.ledgerCogs)}</p><p role="status">${Number(reconciliation.revenueVariance) || Number(reconciliation.cogsVariance) ? "Reconciliation variance" : "Reconciled"}: Revenue ${number(reconciliation.revenueVariance)} · COGS ${number(reconciliation.cogsVariance)}</p><button type="button" class="button secondary" data-report-export>Export report CSV</button>`;
}
export function operationsCsv(report) {
  const csv = (columns, rows) => [columns.map(c => c[1]), ...rows.map(r => columns.map(c => r[c[0]]))];
  const rows = [["Sales, Stock and Profit Report"], ["From", report.period.from, "To", report.period.to, "Currency", report.currency], [report.footnote], [report.stockScope], ...csv(salesColumns, [...report.sales.daily, { ...report.sales.totals, date: "Period total" }])];
  for (const [label, values] of [["Week rollups", report.sales.weekly], ["Month rollups", report.sales.monthly]]) rows.push([], [label], ...csv(salesColumns, values.map(r => ({ ...r, date: `${r.from} to ${r.to}` }))));
  if (report.product) rows.push([], ["Product", report.product.name, "Unit", report.product.unit], ...csv(productColumns, [...report.product.daily, { ...report.product.totals, date: "Period total" }]));
  rows.push([], ["Profit by product"], ...csv(profitColumns, [...report.profit.rows, { ...report.profit.totals, name: "Grand total" }]), [], ["Periodic trial balance reconciliation"], ...Object.entries(report.profit.reconciliation));
  // Prevent user-authored names being interpreted as spreadsheet formulas.
  return rows.map(row => row.map(v => `"${String(typeof v === "string" && /^[=+@-]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? "'" + v : v ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
}

import { ApiError } from "../errors/api-error.js";
import type { ReportPeriod } from "./reporting.types.js";

type Row = Record<string, any>;
export interface ReportSources { invoices: Row[]; credits: Row[]; items: Row[]; returnItems: Row[]; products: Row[]; movements: Row[]; ledger: Row[] }
const scale = 10000n;
function fixed(value: unknown): bigint {
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) throw new ApiError(502, "REPORT_INVALID_AMOUNT", "A report source amount is missing or invalid.");
  return (match[1] ? -1n : 1n) * (BigInt(match[2]!) * scale + BigInt((match[3] ?? "").padEnd(4, "0").slice(0, 4)));
}
const format = (n: bigint) => `${n < 0n ? "-" : ""}${(n < 0n ? -n : n) / scale}.${String((n < 0n ? -n : n) % scale).padStart(4, "0")}`;
const total = (rows: Row[], key: string) => rows.reduce((n, row) => n + fixed(row[key]), 0n);
export const movementDate = (timestamp: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
const posted = new Set(["POSTED", "PAID", "PARTIALLY_PAID"]);
function dates(period: ReportPeriod) {
  const days: string[] = [];
  for (let d = Date.parse(period.from + "T00:00:00Z"); d <= Date.parse(period.to + "T00:00:00Z"); d += 86400000) days.push(new Date(d).toISOString().slice(0, 10));
  return days;
}

/** Pure, read-only projection. All money is aggregated at accounting precision. */
export function projectOperationsReport(source: ReportSources, period: ReportPeriod, productId?: number) {
  const inside = (d: string) => d >= period.from && d <= period.to;
  const invoices = source.invoices.filter(r => posted.has(r.status) && inside(r.issue_date));
  const credits = source.credits.filter(r => r.status === "POSTED" && inside(r.credit_date));
  const currency = [...new Set([...invoices, ...credits].map(r => r.currency_code))];
  if (currency.some(c => c !== "PKR")) throw new ApiError(422, "REPORT_CURRENCY_UNSUPPORTED", "Select PKR transactions; mixed currencies cannot be combined in this report.");
  const saleLines: Row[] = [], returnLines: Row[] = [];
  const cost = (line: Row, header: Row, returned: boolean) => {
    const saved = returned ? line.cogs_reversal_total : line.cogs_total;
    if (saved != null) return fixed(saved);
    const movement = source.movements.find(m => m.product_id === line.product_id && m.reference_id === header.id && m.reference_type === (returned ? "CREDIT_NOTE" : "INVOICE") && m.unit_cost != null);
    const purchase = source.movements.filter(m => m.product_id === line.product_id && m.movement_type === "PURCHASE" && m.unit_cost != null && movementDate(m.created_at) <= (returned ? header.credit_date : header.issue_date)).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)[0];
    const rate = line.unit_cost ?? movement?.unit_cost ?? purchase?.unit_cost ?? source.products.find(p => p.id === line.product_id)?.purchase_price;
    return fixed(line.quantity) * fixed(rate) / scale;
  };
  for (const invoice of invoices) {
    const lines = source.items.filter(r => r.invoice_id === invoice.id).sort((a, b) => a.id - b.id);
    const gross = total(lines, "line_total");
    if (!lines.length || gross === 0n && fixed(invoice.grand_total) !== 0n) throw new ApiError(502, "REPORT_LINES_MISSING", "Posted invoice lines could not be reconciled.");
    let allocated = 0n;
    lines.forEach((line, i) => {
      // Allocate the persisted header net value, assigning rounding residue once.
      const revenue = i === lines.length - 1 ? fixed(invoice.grand_total) - allocated : gross === 0n ? 0n : fixed(line.line_total) * fixed(invoice.grand_total) / gross;
      allocated += revenue;
      saleLines.push({ ...line, date: invoice.issue_date, revenue, cost: cost(line, invoice, false) });
    });
  }
  for (const credit of credits) {
    const lines = source.returnItems.filter(r => r.credit_note_id === credit.id).sort((a, b) => a.id - b.id);
    const gross = total(lines, "line_total");
    if (!lines.length) throw new ApiError(502, "REPORT_LINES_MISSING", "Posted return lines could not be reconciled.");
    let allocated = 0n;
    lines.forEach((line, i) => {
      const revenue = i === lines.length - 1 ? fixed(credit.grand_total) - allocated : gross === 0n ? 0n : fixed(line.line_total) * fixed(credit.grand_total) / gross;
      allocated += revenue;
      returnLines.push({ ...line, date: credit.credit_date, revenue, cost: cost(line, credit, true) });
    });
  }
  const salesRow = (from: string, to: string) => {
    const inv = invoices.filter(r => r.issue_date >= from && r.issue_date <= to), ret = credits.filter(r => r.credit_date >= from && r.credit_date <= to);
    const grossSales = total(inv, "grand_total"), returns = total(ret, "grand_total");
    return { from, to, invoicesCount: inv.length, quantitySold: format(total(saleLines.filter(r => r.date >= from && r.date <= to), "quantity")), grossSales: format(grossSales), returns: format(returns), netSales: format(grossSales - returns) };
  };
  const days = dates(period), daily = days.map(day => ({ date: day, ...salesRow(day, day) }));
  const rollup = (week: boolean) => {
    const groups = new Map<string, string[]>();
    for (const day of days) {
      const d = new Date(day + "T00:00:00Z");
      if (week) d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
      const key = week ? d.toISOString().slice(0, 10) : day.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), day]);
    }
    return [...groups.values()].map(ds => salesRow(ds[0]!, ds.at(-1)!));
  };
  const profitRow = (product: Row) => {
    const sales = saleLines.filter(r => r.product_id === product.id), returns = returnLines.filter(r => r.product_id === product.id);
    const revenue = sales.reduce((n, r) => n + r.revenue, 0n) - returns.reduce((n, r) => n + r.revenue, 0n);
    const cogs = sales.reduce((n, r) => n + r.cost, 0n) - returns.reduce((n, r) => n + r.cost, 0n);
    return { productId: product.id, name: product.name, unit: product.unit, revenue: format(revenue), cogs: format(cogs), grossProfit: format(revenue - cogs) };
  };
  const profits = source.products.filter(p => [...saleLines, ...returnLines].some(r => r.product_id === p.id)).map(profitRow);
  const revenue = total(profits, "revenue"), cogs = total(profits, "cogs");
  const periodLedger = source.ledger.filter(r => inside(r.entry_date));
  const revenueLedger = periodLedger.filter(r => r.code === "4000"), costLedger = periodLedger.filter(r => r.code === "5000");
  const ledgerRevenue = total(revenueLedger, "credit") - total(revenueLedger, "debit"), ledgerCogs = total(costLedger, "debit") - total(costLedger, "credit");
  let product = null;
  if (productId !== undefined) {
    const selected = source.products.find(p => p.id === productId);
    if (!selected) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found in the authorized organization.");
    const movements: Row[] = source.movements.filter(m => m.product_id === productId).map(m => ({ ...m, quantity: m.quantity_delta ?? (["SALE", "PURCHASE_RETURN", "TRANSFER_OUT"].includes(m.movement_type) ? -Math.abs(Number(m.quantity)) : m.quantity) }));
    let stock = total(movements.filter(m => movementDate(m.created_at) < period.from), "quantity");
    const opening = stock;
    const rows = days.map(date => {
      const day = movements.filter(m => movementDate(m.created_at) === date), start = stock;
      const purchased = total(day.filter(m => m.movement_type === "PURCHASE"), "quantity");
      const sold = -total(day.filter(m => m.movement_type === "SALE"), "quantity");
      const returned = total(day.filter(m => m.movement_type === "SALE_RETURN"), "quantity");
      const adjustment = total(day.filter(m => !["PURCHASE", "SALE", "SALE_RETURN"].includes(m.movement_type)), "quantity");
      stock += purchased - sold + returned + adjustment;
      const sales = saleLines.filter(r => r.product_id === productId && r.date === date), returns = returnLines.filter(r => r.product_id === productId && r.date === date);
      const value = sales.reduce((n, r) => n + r.revenue, 0n) - returns.reduce((n, r) => n + r.revenue, 0n), cost = sales.reduce((n, r) => n + r.cost, 0n) - returns.reduce((n, r) => n + r.cost, 0n);
      return { date, openingStock: format(start), purchased: format(purchased), sold: format(sold), returned: format(returned), adjustments: format(adjustment), closingStock: format(stock), salesValue: format(value), cogs: format(cost), profit: format(value - cost) };
    });
    const totals = Object.fromEntries(["purchased", "sold", "returned", "adjustments", "salesValue", "cogs", "profit"].map(k => [k, format(total(rows, k))]));
    product = { id: selected.id, name: selected.name, unit: selected.unit, daily: rows, totals: { ...totals, openingStock: format(opening), closingStock: format(stock) } };
  }
  return { period, currency: "PKR", stockScope: "Selected branch stock movements", footnote: "Posted invoices minus posted returns", sales: { daily, weekly: rollup(true), monthly: rollup(false), totals: salesRow(period.from, period.to) }, products: source.products.map(p => ({ id: p.id, name: p.name, unit: p.unit })), product, profit: { rows: profits, totals: { revenue: format(revenue), cogs: format(cogs), grossProfit: format(revenue - cogs) }, reconciliation: { ledgerRevenue: format(ledgerRevenue), ledgerCogs: format(ledgerCogs), revenueVariance: format(revenue - ledgerRevenue), cogsVariance: format(cogs - ledgerCogs) } } };
}

export class OperationsReportGateway {
  constructor(private readonly client: { from(table: string): any }, private readonly branchId: string) {}
  private async rows(table: string, organizationId: string, select: string, filter: (q: any) => any = q => q, branch = true): Promise<Row[]> {
    const result: Row[] = [];
    for (let offset = 0; offset < 100000; offset += 500) {
      const parent = table === "invoice_items" ? "invoices" : null;
      let query = this.client.from(table).select(select + (parent ? ",invoices!inner(organization_id,branch_id)" : "")).eq(parent ? "invoices.organization_id" : "organization_id", organizationId);
      if (branch) query = query.eq(parent ? "invoices.branch_id" : "branch_id", this.branchId);
      query = filter(query);
      query = table === "general_ledger" ? query.order("journal_entry_id").order("account_id").order("debit").order("credit") : query.order("id");
      const { data, error } = await query.range(offset, offset + 499);
      if (error || !Array.isArray(data)) throw new ApiError(502, "REPORT_READ_FAILED", `${table} report source could not be read.`);
      result.push(...data);
      if (data.length < 500) return result;
    }
    throw new ApiError(422, "REPORT_TOO_LARGE", "Narrow the reporting period; no partial total was returned.");
  }
  async read(organizationId: string, period: ReportPeriod, productId?: number) {
    const [invoices, credits, products, movements, ledger] = await Promise.all([
      this.rows("invoices", organizationId, "id,status,issue_date,currency_code,grand_total", q => q.in("status", [...posted]).gte("issue_date", period.from).lte("issue_date", period.to)),
      this.rows("credit_notes", organizationId, "id,status,credit_date,currency_code,grand_total", q => q.eq("status", "POSTED").gte("credit_date", period.from).lte("credit_date", period.to)),
      this.rows("products", organizationId, "id,name,unit,purchase_price", q => q, false),
      this.rows("stock_movements", organizationId, "id,product_id,movement_type,quantity,quantity_delta,unit_cost,reference_type,reference_id,created_at", q => q.lt("created_at", new Date(Date.parse(period.to + "T00:00:00+05:00") + 86400000).toISOString())),
      this.rows("general_ledger", organizationId, "journal_entry_id,account_id,entry_date,code,debit,credit", q => q.gte("entry_date", period.from).lte("entry_date", period.to)),
    ]);
    const byIds = async (table: string, key: string, ids: number[]) => {
      const result: Row[] = [];
      for (let i = 0; i < ids.length; i += 100) result.push(...await this.rows(table, organizationId, "*", q => q.in(key, ids.slice(i, i + 100))));
      return result;
    };
    const [items, returnItems] = await Promise.all([byIds("invoice_items", "invoice_id", invoices.map(r => r.id)), byIds("credit_note_items", "credit_note_id", credits.map(r => r.id))]);
    return projectOperationsReport({ invoices, credits, products, movements, ledger, items, returnItems }, period, productId);
  }
}

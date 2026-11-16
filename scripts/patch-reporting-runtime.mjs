// Production contains additional controllers and methods absent from the TS
// tree. Change only these two list methods in the pinned, working image.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
export function patchList(source, start, end, replacements) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error("Preserved runtime list method was not found");
  let method = source.slice(first, last);
  for (const [before, after] of replacements) {
    if (method.split(before).length !== 2) throw new Error("Preserved runtime method has changed; refusing a broad patch");
    method = method.replace(before, after);
  }
  return source.slice(0, first) + method + source.slice(last);
}
const root = process.argv[2];
if (root) {
  if (!existsSync(resolve(root, "routes/estimate-browser.routes.js"))) throw new Error("Production estimate routes must be preserved");
  const invoice = resolve(root, "repositories/invoice-browser.repository.js");
  writeFileSync(invoice, patchList(readFileSync(invoice, "utf8"), "async list(organizationId, branchId, limit, cursor)", "async getById(", [
    ['.select(invoiceColumns)', '.select(invoiceColumns + ",invoice_items(quantity)")'],
    ['const rows = (data ?? []);', 'const rows = (data ?? []).map(({ invoice_items, ...row }) => ({ ...row, quantity: (invoice_items ?? []).reduce((n, item) => n + Number(item.quantity), 0) }));'],
  ]));
  const purchase = resolve(root, "services/erp.service.js");
  writeFileSync(purchase, patchList(readFileSync(purchase, "utf8"), "async listPurchases(", "async getPurchase(", [
    ['.select("*")', '.select("*,purchase_items(quantity)")'],
    ['return pageResult(data, page.limit);', 'return pageResult((data ?? []).map(({ purchase_items, ...row }) => ({ ...row, quantity: (purchase_items ?? []).reduce((n, item) => n + Number(item.quantity), 0) })), page.limit);'],
  ]));
  console.log("Preserved production runtime; added invoice and purchase list quantities.");
}

import { icon } from "./icons.js";

export const SANITARY_ELECTRIC = "sanitary_electric";
export const BUILDING_MATERIAL = "building_material";

const labels = new Map([
  [SANITARY_ELECTRIC, "Sanitary & Electric"],
  [BUILDING_MATERIAL, "Building Material"],
]);

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

export function normalizeDocumentTemplate(value) {
  return labels.has(value) ? value : SANITARY_ELECTRIC;
}

export function documentTemplateLabel(value) {
  return labels.get(normalizeDocumentTemplate(value));
}

export function documentTemplateOptions(value = SANITARY_ELECTRIC, name = "document_template", id = "") {
  const selected = normalizeDocumentTemplate(value);
  return `<label class="document-template-field"${id ? ` for="${escapeHtml(id)}"` : ""}>Template<select name="${escapeHtml(name)}"${id ? ` id="${escapeHtml(id)}"` : ""}><option value="${SANITARY_ELECTRIC}"${selected === SANITARY_ELECTRIC ? " selected" : ""}>Sanitary &amp; Electric</option><option value="${BUILDING_MATERIAL}"${selected === BUILDING_MATERIAL ? " selected" : ""}>Building Material</option></select></label>`;
}

const money = (value) => new Intl.NumberFormat("en-PK", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
}).format(Number(value) || 0);

const fixedMoney = (value) => new Intl.NumberFormat("en-PK", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value) || 0);

const quantity = (value) => new Intl.NumberFormat("en-PK", {
  maximumFractionDigits: 3,
}).format(Number(value) || 0);

function dateLabel(value) {
  const date = new Date(`${String(value ?? "").slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  }).format(date);
}

function normalizedLine(line, index) {
  const qty = Number(line.quantity) || 0;
  const netRate = Number(line.net_rate ?? line.unit_price ?? line.rate) || 0;
  const listRate = Number(line.list_rate ?? line.list_price ?? line.rate ?? line.unit_price) || 0;
  const amount = Number(line.line_total ?? line.line_amount ?? qty * netRate) || 0;
  return {
    sr: line.line_number ?? index + 1,
    name: line.product_name ?? line.productLabel ?? line.description ?? "Product name unavailable",
    category: String(line.category ?? "Items").trim() || "Items",
    qty,
    unit: line.unit ?? "unit",
    listRate,
    discountPercent: Number(line.discount_percent) || 0,
    netRate,
    amount,
  };
}

function groupedLines(lines) {
  const groups = new Map();
  for (const [index, raw] of lines.entries()) {
    const line = normalizedLine(raw, index);
    if (!groups.has(line.category)) groups.set(line.category, []);
    groups.get(line.category).push(line);
  }
  return [...groups.entries()].map(([category, rows]) => ({
    category,
    rows,
    subtotal: rows.reduce((total, row) => total + row.amount, 0),
  }));
}

export function mobileDocumentPreview({
  documentType = "estimate",
  template = SANITARY_ELECTRIC,
  documentNumber = "",
  issueDate = "",
  status = "DRAFT",
  customer = {},
  lines = [],
  totals = {},
  notes = "",
}) {
  const selected = normalizeDocumentTemplate(template);
  const building = selected === BUILDING_MATERIAL;
  const quotation = documentType !== "invoice";
  const groups = groupedLines(lines);
  const customerName = customer.name ?? customer.customer_name ?? "Customer name unavailable";
  const address = customer.address ?? customer.city ?? customer.location ?? "";
  const itemCount = Number(totals.item_count ?? lines.length);
  const subtotal = Number(totals.subtotal) || 0;
  const discount = Number(totals.discount_total) || 0;
  const carriage = Number(totals.pass_through_rent ?? totals.carriage ?? 0) || 0;
  const grandTotal = Number(totals.grand_total) || 0;
  const customerPayable = Number(totals.customer_payable_total ?? (grandTotal + carriage)) || 0;
  const statusClass = String(status).toLowerCase().replace(/[^a-z-]/g, "");
  const rows = groups.map((group) => `<section class="document-item-group" aria-label="${escapeHtml(group.category)}">
    <h3>${escapeHtml(group.category)}</h3>
    ${group.rows.map((line) => `<article class="document-line-card">
      <div class="document-line-main"><span class="document-line-number">${escapeHtml(line.sr)}</span><strong class="document-line-name" dir="auto">${escapeHtml(line.name)}</strong><strong class="document-line-amount">PKR ${money(line.amount)}</strong></div>
      <p class="document-line-formula">${building
        ? `Qty ${quantity(line.qty)} ${escapeHtml(line.unit)} • Rate PKR ${money(line.netRate)}`
        : `Qty ${quantity(line.qty)} ${escapeHtml(line.unit)} × List PKR ${money(line.listRate)} − ${quantity(line.discountPercent)}% = Net PKR ${money(line.netRate)}`}</p>
    </article>`).join("")}
    <div class="document-group-subtotal"><span>${escapeHtml(group.category)} subtotal</span><strong>PKR ${money(group.subtotal)}</strong></div>
  </section>`).join("");

  return `<article class="mobile-document-preview ${building ? "building-material" : "sanitary-electric"}" data-document-template="${selected}">
    <header class="mobile-store-banner"><div class="mobile-store-monogram" aria-hidden="true">M</div><div class="mobile-store-copy"><strong>M. MURAD BUILDING MATERIAL STORE</strong><span>Electric | Sanitary | Building Material | Hardware</span><small>0308-6235608 • Plaza No 4, Al Kabir Town, Raiwind Road, Lahore</small></div></header>
    <section class="mobile-document-title"><div class="mobile-document-title-main"><small>${quotation ? "QUOTATION" : "INVOICE"}</small><strong>${escapeHtml(documentNumber)}</strong></div>${building ? '<span class="mobile-template-badge">BUILDING MATERIAL</span>' : ""}<time>${dateLabel(issueDate)}</time><span class="mobile-document-status status-${statusClass}">${escapeHtml(status)}</span></section>
    <section class="mobile-bill-to"><div class="mobile-bill-to-label">${icon("users", 16)}<span>BILL TO</span></div><strong class="mobile-customer-name" dir="auto">${escapeHtml(customerName)}</strong><span class="mobile-customer-contact">${icon("phone", 14)}<span dir="auto">${escapeHtml(customer.phone ?? "")}</span></span><span class="mobile-customer-address">${icon("location", 14)}<span dir="auto">${escapeHtml(address)}</span></span><span class="mobile-customer-count">${quantity(itemCount)} items in total</span></section>
    <div class="mobile-document-groups">${rows || '<p class="mobile-document-empty">No line items.</p>'}</div>
    <footer class="mobile-document-footer"><div class="mobile-document-totals"><div><span>Subtotal</span><strong>PKR ${fixedMoney(subtotal)}</strong></div>${discount > 0 ? `<div><span>Discount</span><strong>PKR ${fixedMoney(discount)}</strong></div>` : ""}<div class="mobile-carriage"><span>Carriage</span><strong>PKR ${fixedMoney(carriage)}</strong></div><div class="mobile-total-divider"></div><div class="mobile-grand-total"><span>Grand Total</span><strong>PKR ${fixedMoney(grandTotal)}</strong></div><div class="mobile-customer-payable"><span>Customer Payable</span><strong>PKR ${fixedMoney(customerPayable)}</strong></div></div>${notes ? `<p class="mobile-document-notes" dir="auto">${escapeHtml(notes)}</p>` : ""}<div class="mobile-signature">Authorized signature <span></span></div></footer>
  </article>`;
}

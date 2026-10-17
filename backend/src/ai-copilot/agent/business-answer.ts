import type { BusinessFact } from "./business-tools.js";

// Render authoritative facts outside the model. The model chooses the tools and
// their sequence, but cannot change verified values or invent a missing value.
export function businessAnswer(facts: BusinessFact[], message: string): string {
  const urdu = /[\u0600-\u06ff]/.test(message);
  const label = (english: string, translated: string) => urdu ? translated : english;
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(2)).toString() : label("unavailable", "دستیاب نہیں");
  const name = (value: unknown) => value && typeof value === "object" && "name" in value ? String(value.name) : "";
  const rendered: string[] = [];
  for (const fact of facts) {
    if (fact.kind === "inventory") {
      const rows = fact.balances as Array<{ warehouseId: number; quantity: number; unit: string }>;
      rendered.push(`${name(fact.product)}: ${label("organization / warehouse stock", "ادارے / گودام کا اسٹاک")} — ${rows.length ? rows.map(row => `${number(row.quantity)} ${row.unit} (${label("warehouse", "گودام")} ${row.warehouseId})`).join("; ") : number(null)}. ${label("Branch on-hand is unsupported; only movement history is branch scoped.", "برانچ کا موجودہ اسٹاک الگ محفوظ نہیں ہوتا؛ صرف نقل و حرکت کی تاریخ برانچ کے مطابق ہے۔")}`);
      if (fact.nextCursor) rendered.push(label("More warehouses exist; this page is not a total.", "مزید گودام موجود ہیں؛ یہ صفحہ کل اسٹاک نہیں ہے۔"));
      if (fact.totalQuantity !== null) rendered.push(`${label("Total organization / warehouse quantity", "ادارے / گودام کی کل مقدار")}: ${number(fact.totalQuantity)} ${nameUnit(fact.product)}.`);
      const movements = fact.movements as Array<{ date: string; type: string; quantity: number; warehouseId: number; referenceType: string; referenceId: unknown }>;
      if (movements.length) rendered.push(label("Recent branch movements: ", "برانچ کی حالیہ نقل و حرکت: ") + movements.map(row => `${row.date} ${row.type} ${number(row.quantity)} (${row.warehouseId}; ${row.referenceType} ${row.referenceId ?? ""})`).join("; "));
    } else if (fact.kind === "margin") {
      const sale = fact.saleRate as { unit_price: number; unit: string; currency_code: string } | null;
      const cost = fact.purchaseCost as { unit_price: number; unit: string; currency_code: string } | null;
      rendered.push(`${name(fact.product)}: ${label("sale rate", "فروخت کی قیمت")} ${sale ? `${sale.currency_code} ${number(sale.unit_price)}/${sale.unit}` : number(null)}; ${label("active purchase rate cost", "فعال خرید ریٹ کی لاگت")} ${cost ? `${cost.currency_code} ${number(cost.unit_price)}/${cost.unit}` : number(null)}. ${label("Quantity", "مقدار")} ${number(fact.quantity)}, ${label("discount", "رعایت")} ${number(fact.discountPercent)}%. ${label("Net revenue", "خالص آمدن")} ${fact.currencyCode ?? ""} ${number(fact.revenue)}; ${label("estimated gross profit", "تخمینی مجموعی منافع")} ${number(fact.grossProfit)}; ${label("margin", "مارجن")} ${fact.marginPercent == null ? number(null) : number(fact.marginPercent) + "%"}. ${fact.reason ?? ""} ${label("Estimate based on active purchase rates; not realized accounting profit.", "یہ فعال خرید ریٹ پر مبنی تخمینہ ہے؛ حقیقی حسابی منافع نہیں۔")}`);
    } else if (fact.kind === "customer_ledger") {
      const balances = fact.balances as Array<{ currency_code: string; debit: number; credit: number; outstanding: number }>;
      const transactions = fact.transactions as Array<{ date: string; referenceType: string; referenceId: number; debit: number; credit: number; currencyCode: string; journals: Array<{ id: string }> }>;
      const payment = fact.latestPayment as { date: string; amount: number; currencyCode: string; referenceId: number } | null;
      rendered.push(`${name(fact.customer)} (${label("current branch ledger", "موجودہ برانچ کا کھاتہ")}): ${balances.length ? balances.map(row => `${row.currency_code}: ${label("debit", "ڈیبٹ")} ${number(row.debit)}, ${label("credit", "کریڈٹ")} ${number(row.credit)}, ${label("outstanding", "بقایا")} ${number(row.outstanding)}`).join("; ") : label("No ledger entries; currency balance is unavailable.", "کھاتے میں کوئی اندراج نہیں؛ کرنسی کے مطابق بقایا دستیاب نہیں۔")}`);
      rendered.push(payment ? `${label("Latest payment", "آخری ادائیگی")}: ${payment.date}, ${payment.currencyCode} ${number(payment.amount)} (${payment.referenceId}).` : label("No payment is recorded in this branch ledger.", "اس برانچ کے کھاتے میں کوئی ادائیگی درج نہیں ہے۔"));
      if (transactions.length) rendered.push(label("Transactions: ", "لین دین: ") + transactions.map(row => `${row.date} ${row.referenceType} ${row.referenceId}: ${row.currencyCode} ${label("debit", "ڈیبٹ")} ${number(row.debit)} / ${label("credit", "کریڈٹ")} ${number(row.credit)}${row.journals.length ? " (" + row.journals.map(j => j.id).join(", ") + ")" : ""}`).join("; "));
      if (fact.nextCursor) rendered.push(label("More transactions are available on the next page.", "مزید لین دین اگلے صفحے پر دستیاب ہیں۔"));
    } else if (fact.kind === "comparison") {
      const rows = fact.rows as BusinessFact[]; const values = fact.values as unknown[];
      rendered.push(`${label("Comparison", "موازنہ")} (${fact.metric}): ${rows.map((row, index) => `${name(row.product)} ${number(values[index])}${fact.metric === "margin" && values[index] != null ? "%" : ""} ${fact.metric === "margin" ? "" : fact.metric === "stock" ? nameUnit(row.product) : String(row.currencyCode ?? (row.purchaseCost as { currency_code?: string } | null)?.currency_code ?? "")}`).join("; ")}. ${label("Selected", "منتخب")}: ${(fact.winners as unknown[]).map(name).join(", ") || number(null)}. ${fact.reason ?? ""}`);
      if (["profit", "margin"].includes(String(fact.metric))) rendered.push(`${label("Quantity", "مقدار")}: ${number(fact.quantity)}; ${label("discount", "رعایت")}: ${number(fact.discountPercent)}%.`);
      if (fact.metric === "stock") rendered.push(label("Stock comparison uses organization / warehouse balances; branch stock is unsupported.", "اسٹاک کا موازنہ ادارے / گودام کے مطابق ہے؛ برانچ کا اسٹاک دستیاب نہیں۔"));
      if (["purchase_cost", "profit", "margin"].includes(String(fact.metric))) rendered.push(label("Costs and profit use active purchase rates as an estimate.", "لاگت اور منافع فعال خرید ریٹ کے مطابق تخمینے ہیں۔"));
    } else if (fact.kind === "payment_preparation") {
      const payment = fact.payment as { amount: number; payment_date: string; payment_method: string; currency_code?: string; allocations: Array<{ amount: number; invoice_id?: number; purchase_id?: number }> };
      rendered.push(`${label(fact.intent === "customer_payment" ? "Customer receipt review" : "Vendor payment review", fact.intent === "customer_payment" ? "گاہک کی وصولی کا جائزہ" : "فراہم کنندہ کی ادائیگی کا جائزہ")}: ${fact.partyName}, ${payment.currency_code ?? label("currency not tracked by vendor domain", "فراہم کنندہ کے نظام میں کرنسی درج نہیں ہوتی")}, ${number(payment.amount)}, ${payment.payment_date}, ${payment.payment_method}. ${label("Allocations", "مختص رقم")}: ${payment.allocations.map(row => `${row.invoice_id ?? row.purchase_id}: ${number(row.amount)}`).join("; ")}. ${label("Nothing executed. Review, prepare, then explicitly confirm the approval draft.", "کچھ اجرا نہیں ہوا۔ جائزہ لیں، مسودہ تیار کریں، پھر واضح تصدیق کریں۔")}`);
    } else if (fact.kind === "payment_documents") {
      rendered.push(`${name(fact.party)}: ${label("Payment allocation documents", "ادائیگی کے متعلق دستاویزات")} — ${(fact.data as Array<Record<string, unknown>>).map(row => `${row.invoice_id ?? row.purchase_id} (${row.invoice_number ?? ""}): ${row.currency_code ?? ""} ${label("outstanding", "بقایا")} ${number(row.outstanding)}`).join("; ") || label("none available", "کوئی دستیاب نہیں")}. ${label("Specify the payment date, method, amount and allocations before preparation.", "تیاری سے پہلے ادائیگی کی تاریخ، طریقہ، رقم اور متعلقہ دستاویزات بتائیں۔")}`);
    } else if (fact.kind === "sale_rate") {
      const rate = fact.rate as { unit_price: number; currency_code: string; unit: string } | null;
      rendered.push(label("Current sale rate: ", "فروخت کا موجودہ ریٹ: ") + (rate ? `${rate.currency_code} ${number(rate.unit_price)}/${rate.unit}` : number(null)));
    } else if (fact.kind === "unavailable") rendered.push(String(fact.message));
  }
  return rendered.join("\n\n");
}
function nameUnit(value: unknown) { return value && typeof value === "object" && "unit" in value ? String(value.unit) : ""; }

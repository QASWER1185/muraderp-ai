import { createCopilotDraft, createCopilotReview, askCopilot, askCopilotMedia, prepareConversationDraft, prepareConversationPayment, quoteCopilotEstimateLine, createCopilotRateListDraft, extractInvoiceDocument, confirmCopilotDraft, getCopilotProviderStatus, testCopilotProvider } from "./copilot-api.js";
import { clearCopilotApiKey, getCopilotApiKey, saveCopilotApiKey } from "./copilot-key.js";
import { queueJsonRequest } from "./offline-sync.js";
import { getWorkspaceContext } from "./workspace-context.js";
import { icon } from "./icons.js";
import { copilotRecoveryMessage } from "./copilot-recovery.js";

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const CONVERSATION_MAX_AGE_MS = 29 * 60_000;
const MEDIA_TYPES = new Set(["image/jpeg","image/png","image/webp","application/pdf","audio/webm","audio/mp4","audio/mpeg","audio/wav","audio/ogg"]);
export function erpActionReviewMarkup(review) {
  const preview=review.preview;
  const lines=preview.lines??[];
  const quotation=preview.quotation;
  const grouped=quotation?.sections?.map(section=>`<section><h4>${escapeHtml(section.brand)}</h4><div class="shop-table"><table><thead><tr>${["آئٹم","سائز","مقدار","لسٹ ریٹ PKR","رعایت %","خالص رقم PKR"].map(label=>`<th>${label}</th>`).join("")}</tr></thead><tbody>${section.lines.map(line=>`<tr>${[line.name,line.size??"—",`${line.quantity} ${line.unit}`,line.rate,line.discountPercent??"—",line.amount].map(value=>`<td><bdi dir="auto">${escapeHtml(value)}</bdi></td>`).join("")}</tr>`).join("")}</tbody></table></div><p>برانڈ رعایت: <bdi dir="ltr">PKR ${escapeHtml(section.savings)}</bdi> · رقم: <bdi dir="ltr">PKR ${escapeHtml(section.total)}</bdi></p></section>`).join("");
  return `<article class="review-card confirmation-card" dir="auto"><h3>${preview.incomplete?"نرخوں کی تصدیق کا مسودہ":"منظوری کے لیے پری ویو"}</h3>${formatCopilotAnswer(preview.summary)}<div class="review-lines">${grouped??lines.map((line,index)=>`<div class="review-line"><strong>${index+1}. ${escapeHtml(line.productName??line.name??"")}</strong><p>${escapeHtml(line.quantity??line.qty??"")} ${escapeHtml(line.unit??"")} · نرخ ${escapeHtml(line.pending?"پینڈنگ تصدیق":line.unit_price??line.list_price??"")} · رعایت ${escapeHtml(line.discountPercent??0)}%</p></div>`).join("")}</div>${preview.totals?`<p><strong>کل رقم: <bdi dir="ltr">PKR ${escapeHtml(preview.totals.grand_total)}</bdi></strong></p>`:""}${preview.warnings?.length?`<p class="review-warning">${escapeHtml(preview.warnings.join(" "))}</p>`:""}${quotation?`<details><summary>گاہک کا واٹس ایپ کارڈ</summary><pre data-customer-quotation>${escapeHtml(quotation.text)}</pre><button type="button" class="button secondary" data-copy-quotation>متن کاپی کریں</button><button type="button" class="button secondary" data-download-card>کارڈ ڈاؤن لوڈ کریں</button></details>`:""}${preview.privateMargin?`<details class="merchant-scorecard"><summary>صرف دکاندار کے لیے مارجن</summary><p>${preview.privateMargin.costsKnown?`خرید لاگت: PKR ${escapeHtml(preview.privateMargin.cost)} · متوقع مجموعی منافع: PKR ${escapeHtml(preview.privateMargin.grossProfit)}`:"خرید لاگت کی مکمل تصدیق دستیاب نہیں؛ منافع کا اندازہ نہیں لگایا گیا۔"}</p></details>`:""}${preview.challan?`<details open><summary>بغیر نرخ کا ڈسپیچ چلّان</summary><pre data-customer-quotation>${escapeHtml(preview.challan.text)}</pre><button type="button" class="button secondary" data-download-card>چلّان ڈاؤن لوڈ کریں</button></details>`:""}<button type="button" class="button secondary" data-draft-cancel>منسوخ کریں</button>${preview.incomplete?"":'<button type="button" class="button primary" data-confirm-draft>تصدیق کریں اور محفوظ کریں</button>'}</article>`;
}
export function depotReportMarkup(report){
  if(report.catalogIntegrity===true)return `<article class="review-card" dir="auto"><h3>کیٹلاگ نرخوں کی پڑتال</h3>${report.rows.map(row=>`<p>${escapeHtml(row.name)} · موجودہ ${escapeHtml(row.currentListPrice??"نامعلوم")} · کیٹلاگ ${escapeHtml(row.expectedListPrice)} · ${row.status==="verified"?"تصدیق شدہ":"درستگی کا پری ویو درکار"}</p>`).join("")}<p>قیمتوں کی تبدیلی الگ پری ویو اور واضح منظوری کے بعد محفوظ ہو گی۔</p></article>`;
  if(report.analytics===true){
    const labels={rank:"درجہ",name:"نام",currency:"کرنسی",unit:"یونٹ",salesVolume:"خالص فروخت",revenue:"آمدن",cogs:"لاگت",grossProfit:"مجموعی منافع",netProfit:"خالص منافع",operatingExpenses:"اخراجات",purchaseVolume:"خالص خریداری",outstanding:"بقایا",quantity:"مقدار",marginPercent:"مارجن %",onHand:"موجودہ اسٹاک",lastMovement:"آخری نقل و حرکت",productCount:"کیٹلاگ آئٹمز",productsWithStock:"دستیاب اسٹاک والے آئٹمز",cashIn:"نقد وصولی",cashOut:"نقد ادائیگی",openingBalance:"ابتدائی نقد",closingBalance:"موجودہ نقد",salesCounterCollections:"کاؤنٹر وصولی"};
    const english=report.language==="en";
    if(english)Object.assign(labels,{rank:"Rank",name:"Name",currency:"Currency",unit:"Unit",salesVolume:"Net sales",revenue:"Revenue",cogs:"COGS",grossProfit:"Gross profit",netProfit:"Net profit",operatingExpenses:"Operating expenses",purchaseVolume:"Net purchases",outstanding:"Outstanding",quantity:"Quantity",marginPercent:"Margin %",onHand:"On hand",lastMovement:"Last movement",productCount:"Catalog products",productsWithStock:"Products with stock",cashIn:"Cash in",cashOut:"Cash out",openingBalance:"Opening cash",closingBalance:"Closing cash",salesCounterCollections:"Counter collections"});
    const table=rows=>{if(!rows?.length)return "";const columns=Object.keys(labels).filter(key=>rows.some(row=>Object.hasOwn(row,key)));return `<div class="analytics-table"><table><thead><tr>${columns.map(key=>`<th>${labels[key]}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(key=>`<td>${escapeHtml(row[key]??"—")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;};
    const metrics=Object.entries(report.metrics??{}).filter(([key,value])=>labels[key]&&!Array.isArray(value)).map(([key,value])=>`<p>${labels[key]}: <strong>${escapeHtml(value)}</strong></p>`).join("");
    return `<article class="review-card analytics-report" dir="auto"><h3>${english?"Business report":"کاروباری رپورٹ"}</h3><p>${escapeHtml(report.period?.from??"")} — ${escapeHtml(report.period?.to??"")}</p>${metrics}${table(report.rows)}${report.metrics?.highestVolume?.length?`<h4>${english?"Highest sales volume":"مقدار کے لحاظ سے سب سے زیادہ فروخت"}</h4>${table(report.metrics.highestVolume)}`:""}${report.metrics?.highestMargin?.length?`<h4>${english?"Highest margin":"سب سے زیادہ مارجن"}</h4>${table(report.metrics.highestMargin)}`:""}</article>`;
  }
  if(!Array.isArray(report.issues))return "";
  return `<article class="review-card" dir="auto"><h3>طلب اور وینڈر کوٹیشن کی پڑتال</h3>${report.issues.map(issue=>`<p class="${issue.negativeMargin||["quantity","specification","negative_margin"].includes(issue.kind)?"negative-margin":"review-warning"}">${escapeHtml(issue.message)}</p>`).join("")}${Array.isArray(report.corrected)?`<details><summary>درست کوٹیشن کا پری ویو</summary>${report.corrected.map(line=>`<p>${escapeHtml(line.name)} · مقدار ${escapeHtml(line.quantity)} · معیار ${escapeHtml(line.specification)} · رعایت ${escapeHtml(line.discount)}%</p>`).join("")}</details>`:""}</article>`;
}
async function downloadCustomerCard(text) {
  const rows=String(text).split("\n").flatMap(line=>{
    const words=line.split(/\s+/u),chunks=[];let current="";
    for(const word of words){if(current.length+word.length>65){chunks.push(current);current=word;}else current+=(current?" ":"")+word;}
    chunks.push(current);return chunks;
  });
  const width=1000,height=100+rows.length*42;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><g fill="#142c23" font-family="Arial,sans-serif" font-size="24" direction="rtl" text-anchor="end">${rows.map((row,index)=>`<text x="960" y="${55+index*42}" unicode-bidi="plaintext">${escapeHtml(row)}</text>`).join("")}</g></svg>`;
  const source=URL.createObjectURL(new Blob([svg],{type:"image/svg+xml;charset=utf-8"}));
  try{
    const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=source;});
    const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;canvas.getContext("2d").drawImage(image,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
    if(!blob)throw new Error("کارڈ تیار نہیں ہو سکا۔");
    const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="MuradERP-quotation.png";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }finally{URL.revokeObjectURL(source);}
}
export function customerDraftState(review, context, userId) {
  if (review?.intent !== "customer_create" || review.requiresConfirmation !== true ||
      [review.draftId, review.idempotencyKey, review.name, review.phone, review.city].some(value => typeof value !== "string" || !value.trim())) throw new Error("Customer draft is incomplete. No customer has been created.");
  return { id: review.draftId, idempotencyKey: review.idempotencyKey, intent: review.intent, organizationId: context.organizationId, branchId: context.branchId, userId };
}
export function customerDraftReviewMarkup(review) {
  return `<article class="review-card confirmation-card"><span class="status-pill review">Confirmation required</span><h3>New customer</h3><p>Name: ${escapeHtml(review.name)}</p><p>Phone: ${escapeHtml(review.phone)}</p><p>City/address: ${escapeHtml(review.city)}</p><p>No customer has been created. Check these details before confirming.</p><div class="review-actions"><button class="button secondary" type="button" data-draft-cancel>Cancel</button><button class="button danger" type="button" data-confirm-draft>Confirm customer creation</button></div></article>`;
}
export function customerPreparationMarkup() {
  return '<article class="review-card" data-customer-preparation><span class="status-pill review">Details required</span><h3>Prepare new customer</h3><div class="review-fields"><label>Name<input name="name" type="text" maxlength="200" required /></label><label>Phone<input name="phone" type="tel" maxlength="50" required /></label><label>City/address<input name="city" type="text" maxlength="120" required /></label></div><p>Customer creation requires a separate explicit confirmation.</p><button class="button primary" type="button" data-prepare-customer>Prepare customer review</button></article>';
}
export function validateAttachment(file) {
  const suppliedMime=String(file.type).split(";")[0].trim().toLowerCase();
  const mimeType=suppliedMime==="image/jpg"?"image/jpeg":suppliedMime;
  if(!MEDIA_TYPES.has(mimeType)) throw new Error("Use a JPEG, PNG, WebP, PDF, or supported audio file.");
  if(!file.size) throw new Error("The attachment is empty.");
  if(file.size>MAX_MEDIA_BYTES) throw new Error("Attachments must be 8 MB or smaller.");
  return mimeType;
}
export function ambiguityMarkup(clarification) {
  return `<article class="review-card" data-agent-ambiguity><h3>درست ${clarification.kind==="product"?"آئٹم":clarification.kind==="vendor"?"فراہم کنندہ":"گاہک"} منتخب کر لیں</h3><p>اسی گفتگو کو آگے بڑھانے کے لیے درست ریکارڈ منتخب کریں۔</p>${clarification.candidates.map(row=>`<button class="button secondary" type="button" data-agent-candidate="${escapeHtml(row.id)}" data-candidate-kind="${escapeHtml(clarification.kind)}">${escapeHtml(row.name)}${row.city?" · "+escapeHtml(row.city):""}${row.sku?" · "+escapeHtml(row.sku):""}</button>`).join("")}</article>`;
}
export function extractionMarkup(extraction,reviewText) {
  const transcript=extraction.transcript?`<p class="voice-transcript">صوتی ہدایت: ${escapeHtml(extraction.transcript)}</p>`:"";
  if (extraction.catalog) {
    const catalog = extraction.catalog;
    return `<article class="review-card" data-input-review><h3>${escapeHtml(catalog.name)}</h3><p>${catalog.items.length} کیٹلاگ آئٹمز · عمومی رعایت ${escapeHtml(catalog.standardDiscountPercent ?? "درج نہیں")}%</p><details><summary>تمام نکالے گئے آئٹمز دیکھیں</summary>${catalog.items.map(item => `<p>${escapeHtml(item.brand)} · ${escapeHtml(item.category)} · ${escapeHtml(item.name)} · ${escapeHtml(item.size)} · ${escapeHtml(item.unit)} · چھپا ہوا نرخ PKR ${escapeHtml(item.list_price)}</p>`).join("")}</details>${catalog.warnings.length ? `<p class="review-warning">${escapeHtml(catalog.warnings.join(" "))}</p>` : ""}</article>`;
  }
  if(extraction.transcript && !extraction.document) return `<article class="review-card"><h3>صوتی پیغام کی عبارت</h3>${transcript}<p>گاہک اور سامان کی شناخت کے بعد موجودہ ERP نرخ استعمال ہوں گے۔</p></article>`;
  const doc=extraction.document;
  if(!doc) return "";
  return `<article class="review-card" data-input-review><h3>پرچی سے پڑھی گئی تفصیل</h3>${transcript}<p>گاہک: ${escapeHtml(doc.customerName??"نام واضح کر دیں")}۔ شناخت کا اعتماد ${Math.round(doc.confidence*100)}%۔</p>${doc.lines.map(line=>`<p><bdi dir="auto">${escapeHtml([line.material,line.productName,line.specification,line.size].filter(Boolean).join(" · "))}</bdi> · ${escapeHtml(line.quantity??"مقدار واضح کر دیں")} ${escapeHtml(line.unit??"کیٹلاگ کا یونٹ")} · پرچی کا نرخ ${escapeHtml(line.unitRate??"درج نہیں")} · رعایت ${escapeHtml(line.discountPercent??doc.discountPercent??"درج نہیں")}%</p>`).join("")}<p>پرچی کی ابتدائی رقم: ${escapeHtml(doc.subtotal??"درج نہیں")}؛ کل: ${escapeHtml(doc.total??"درج نہیں")}۔ ایسٹیمیٹ کی قیمت فعال ERP ریٹ لسٹ سے لی گئی ہے۔</p>${doc.warnings?.length?`<p class="review-warning">${escapeHtml(doc.warnings.join(" "))}</p>`:""}${reviewText?`<label>ضرورت ہو تو پڑھی گئی تفصیل درست کر دیں<textarea data-input-review-text maxlength="4000">${escapeHtml(reviewText)}</textarea></label><button class="button primary" type="button" data-use-reviewed-input>درست تفصیل کے ساتھ آگے بڑھیں</button>`:""}</article>`;
}

function conversationStorage(){try{return globalThis.sessionStorage;}catch{return null;}}
export function createCopilotConversation(now = Date.now, storage = conversationStorage()) {
  let token = null;
  let scope = null;
  let expiresAt = 0;
  let conversationId = null;
  const storageKey="muraderp-copilot-conversation-v1";
  const forget=()=>{try{storage?.removeItem(storageKey);}catch{}};
  try {
    const saved=JSON.parse(storage?.getItem(storageKey)??"null");
    if(saved && typeof saved.token==="string" && saved.token.length<=9000 && typeof saved.scope==="string" &&
      typeof saved.conversationId==="string" && saved.expiresAt>now() && saved.expiresAt<=now()+CONVERSATION_MAX_AGE_MS){
      token=saved.token;scope=saved.scope;conversationId=saved.conversationId;expiresAt=saved.expiresAt;
    }else forget();
  }catch{forget();}
  const key = (userId, organizationId, branchId) => JSON.stringify([userId, organizationId, branchId]);
  return {
    tokenFor(userId, organizationId, branchId) {
      const current = key(userId, organizationId, branchId);
      if (scope !== current || now() >= expiresAt) { token = null; conversationId = null; scope = current; forget(); }
      return token;
    },
    idFor(userId, organizationId, branchId) { this.tokenFor(userId, organizationId, branchId); return conversationId; },
    accept(value, userId, organizationId, branchId, id) {
      scope = key(userId, organizationId, branchId);
      token = typeof value === "string" && value.length > 0 && value.length <= 9000 ? value : null;
      expiresAt = token ? now() + CONVERSATION_MAX_AGE_MS : 0;
      conversationId = token && typeof id === "string" ? id : null;
      try{if(token && conversationId)storage?.setItem(storageKey,JSON.stringify({token,scope,conversationId,expiresAt}));else forget();}catch{}
    },
    clear() { token = null; conversationId = null; scope = null; expiresAt = 0; forget(); },
  };
}
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
/** Small escaped Markdown subset: no HTML, links, images or executable markup. */
export function formatCopilotAnswer(value){
  const inline=text=>escapeHtml(text).replace(/\*\*([^*\n]+)\*\*/g,"<strong>$1</strong>")
    .replace(/(?:PKR\s+[\d,.]+|PN-\d+|\d+(?:\.\d+)?\s*mm\b)/g,'<bdi dir="ltr">$&</bdi>');
  const lines=String(value??"").split("\n"),parts=[];
  for(let i=0;i<lines.length;i++){
    if(/^\s*\|.*\|\s*$/.test(lines[i])&&/^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[i+1]??"")){
      const cells=line=>line.trim().slice(1,-1).split("|").map(cell=>cell.trim());
      const headers=cells(lines[i]),rows=[];i+=2;
      while(i<lines.length&&/^\s*\|.*\|\s*$/.test(lines[i]))rows.push(cells(lines[i++]));i--;
      parts.push(`<div class="shop-table"><table><thead><tr>${headers.map(cell=>`<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${headers.map((_,j)=>`<td><bdi dir="auto">${inline(row[j]??"")}</bdi></td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    }else if(/^\s*[-*]\s+/.test(lines[i])){
      const items=[];while(i<lines.length&&/^\s*[-*]\s+/.test(lines[i]))items.push(`<li>${inline(lines[i++].replace(/^\s*[-*]\s+/,""))}</li>`);i--;parts.push(`<ul>${items.join("")}</ul>`);
    }else if(lines[i].trim())parts.push(`<p>${inline(lines[i])}</p>`);
  }
  return parts.join("");
}
function apiIntent(action) { return action === "purchase" ? "supplier_bill" : action === "return" ? "customer_return" : action; }
function fieldValue(field) { return field && typeof field === "object" && "value" in field ? field.value : undefined; }
function humanIntent(intent) { return ({ estimate: "Estimate", supplier_bill: "Supplier bill", customer_return: "Customer return", inventory_adjustment: "Stock adjustment", rate_list_update: "Rate list update", invoice: "Invoice" })[intent] ?? "ERP action"; }

export function conversationDraftMarkup(draft) {
  return `<article class="review-card" data-conversation-draft><div class="review-heading"><h3>ایسٹیمیٹ کا مسودہ</h3><span class="status-pill review">${draft.prepared ? "مکمل پری ویو" : "جاری مسودہ"}</span></div>
    <p>گاہک: ${escapeHtml(draft.customer?.name ?? "گاہک کا نام بتا دیں")}</p>
    <div class="review-lines">${(draft.lines ?? []).map(line => `<div class="review-line"><strong>${escapeHtml(line.productName)}</strong><p>${escapeHtml(line.quantity)} ${escapeHtml(line.unit)} · رعایت ${escapeHtml(line.discountPercent)}%</p><p>${line.rate ? escapeHtml(line.rate.currency_code) + " " + escapeHtml(line.rate.unit_price) + " / " + escapeHtml(line.rate.unit) : "فعال نرخ واضح کر دیں"}</p><p>${line.amount == null ? "اس لائن کا نرخ یا یونٹ واضح کر دیں۔" : escapeHtml(draft.currencyCode) + " " + escapeHtml(line.amount.toFixed(2))}</p></div>`).join("")}</div>
    ${draft.totals?`<p>ابتدائی رقم: ${escapeHtml(draft.currencyCode)} ${escapeHtml(draft.totals.subtotal?.toFixed(2) ?? "دستیاب نہیں")} · رعایت: ${escapeHtml(draft.currencyCode)} ${escapeHtml(draft.totals.discount_total?.toFixed(2) ?? "دستیاب نہیں")}</p>`:""}
    <p><strong>${draft.totals ? "کل رقم: " + escapeHtml(draft.currencyCode) + " " + escapeHtml(draft.totals.grand_total.toFixed(2)) : "تمام لائنوں کے درست نرخ آنے پر کل رقم تیار ہو جائے گی۔"}</strong></p>
    <p>اسی گفتگو میں سامان شامل، کم یا درست کر سکتے ہیں۔ آخر میں منظوری کے بعد ریکارڈ محفوظ ہوگا۔</p>
    ${draft.prepared && draft.totals ? '<button class="button primary" type="button" data-prepare-conversation-draft>مسودہ تیار کریں</button>' : ""}</article>`;
}

export function conversationPaymentMarkup(preparation, ready = false) {
  const payment = preparation.payment;
  const receipt = preparation.intent === "customer_payment";
  return `<article class="review-card" data-conversation-payment><div class="review-heading"><h3>${receipt ? "Customer receipt" : "Vendor payment"}</h3><span class="status-pill review">Review required</span></div>
    <p>${escapeHtml(preparation.partyName)} · ${escapeHtml(payment.currency_code ?? "Currency is not tracked by the vendor payment domain")} ${escapeHtml(payment.amount)}</p>
    <p>Date: ${escapeHtml(payment.payment_date)} · Method: ${escapeHtml(payment.payment_method)}</p>
    <div class="review-lines">${payment.allocations.map(row => `<p>${receipt ? "Invoice" : "Purchase"} ${escapeHtml(row.invoice_id ?? row.purchase_id)}: ${escapeHtml(row.amount)}</p>`).join("")}</div>
    ${payment.reference_number || payment.reference ? `<p>Reference: ${escapeHtml(payment.reference_number ?? payment.reference)}</p>` : ""}
    ${payment.notes ? `<p>Notes: ${escapeHtml(payment.notes)}</p>` : ""}
    <p>${receipt ? "This receives a customer payment against the listed invoices." : "This pays a vendor against the listed purchases."} Nothing is posted until explicit confirmation.</p>
    ${ready ? "" : '<button class="button primary" type="button" data-prepare-conversation-payment>Prepare payment draft</button>'}</article>`;
}

export function attachmentLabel(file) {
  if (!file) return "";
  const size = file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  return `${file.name || "Voice recording"} | ${size}`;
}

export function sourceForAttachment(file, camera = false) {
  if (!file) return "text";
  if (String(file.type).startsWith("audio/")) return "voice";
  return camera ? "camera" : "image";
}

async function readFileAsBase64(file) {
  const mimeType=validateAttachment(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  return { mimeType, base64: btoa(binary) };
}

function matchField(label, match, name) {
  if (!match || match.status === "not_requested") return "";
  const candidates = match.candidates ?? [];
  if (!candidates.length) return `<div class="review-field warning"><span>${label}</span><strong>No verified match</strong></div>`;
  return `<label class="review-field"><span>${label}</span><select data-match="${name}"><option value="">Choose a verified match</option>${candidates.map((candidate) => `<option value="${candidate.id}"${candidate.id === match.selectedId ? " selected" : ""}>${escapeHtml(candidate.label)} (${Math.round(candidate.confidence * 100)}%)</option>`).join("")}</select></label>`;
}

export function selectReviewProduct(line, productId) {
  line.product.selectedId = productId || undefined;
  line.product.status = productId ? "matched" : "unresolved";
  line.warnings = (line.warnings ?? []).filter((warning) => !/Multiple products match|Product could not be matched|Choose a verified product/i.test(warning));
  if (!productId) line.warnings.push("Choose a verified product.");
  return line;
}

function reviewLineMarkup(line, index, intent) {
  const productOptions = (line.product?.candidates ?? []).map((candidate) => `<option value="${candidate.id}"${candidate.id === line.product.selectedId ? " selected" : ""}>${escapeHtml(candidate.label)} (${Math.round(candidate.confidence * 100)}%)</option>`).join("");
  const rateOptions = (line.rateList?.candidates ?? []).map((candidate) => `<option value="${candidate.id}"${candidate.id === line.rateList.selectedId ? " selected" : ""}>${escapeHtml(candidate.label)}</option>`).join("");
  return `<div class="review-line" data-review-line="${index}"><div class="review-line-title"><span>${index + 1}</span><strong>${escapeHtml(line.productName || "Unrecognized product")}</strong></div><div class="review-line-grid">
    <label><span>Matched product</span><select data-line-product><option value="">Choose a verified match</option>${productOptions}</select></label>
    <label><span>Quantity</span><input data-line-quantity type="number" min="0.001" step="any" value="${escapeHtml(line.quantity ?? "")}" /></label>
    <label><span>Unit</span><input data-line-unit value="${escapeHtml(line.unit ?? "")}" /></label>
    ${intent === "estimate" ? `<div class="review-field"><span>Authorized sale rate</span><strong data-resolved-rate>${line.resolvedPrice ? `${escapeHtml(line.resolvedPrice.currency_code)} ${escapeHtml(line.resolvedPrice.unit_price)} / ${escapeHtml(line.resolvedPrice.unit)}` : "Needs verification"}</strong></div><div class="review-field"><span>Amount</span><strong data-line-amount>${line.amount == null ? "Needs verification" : `${escapeHtml(line.resolvedPrice?.currency_code)} ${escapeHtml(line.amount)}`}</strong></div>` : `<label><span>Rate</span><input data-line-rate type="number" min="0" step="any" value="${escapeHtml(line.explicitUnitRate ?? "")}" /></label>`}
    ${rateOptions ? `<label><span>Rate list</span><select data-line-rate-list><option value="">Use workspace pricing</option>${rateOptions}</select></label>` : ""}
  </div>${line.warnings?.length ? `<p class="review-warning">${escapeHtml(line.warnings.join(" "))}</p>` : ""}</div>`;
}

export function reviewCardMarkup(review) {
  const confidence = Math.round((review.confidence ?? 0) * 100);
  const needsAttention = Boolean(review.blockingReasons?.length || (review.intent === "estimate" && review.lines?.some((line) => !line.resolvedPrice)));
  return `<article class="review-card" data-review-card><div class="review-heading"><div><span class="status-pill review">Review required</span><h3>${escapeHtml(humanIntent(review.intent))}</h3></div><span class="confidence">${confidence}% confidence</span></div>
    <div class="review-fields">${matchField("Customer", review.customer, "customer")}${matchField("Vendor", review.vendor, "vendor")}${matchField("Warehouse", review.warehouse, "warehouse")}</div>
    <div class="review-lines">${(review.lines ?? []).map((line, index) => reviewLineMarkup(line, index, review.intent)).join("")}</div>
    <div class="review-notice" data-review-notice${needsAttention ? "" : " hidden"}>${icon("alert")}<span><strong>Needs attention</strong><small>Resolve the highlighted matches and missing values before preparing a draft.</small></span></div>
    <div class="review-actions"><button class="button secondary" type="button" data-review-cancel>Cancel</button><button class="button primary" type="button" data-prepare-draft${needsAttention ? " disabled" : ""}>Prepare draft</button></div></article>`;
}

export function mountCopilot({ getAuthenticatedUserId, openNativeAction }) {
  const dialog = document.querySelector("#copilot");
  const keyDialog = document.querySelector("#copilot-key-dialog");
  const keyForm = document.querySelector("#copilot-key-form");
  const keyInput = document.querySelector("#copilot-api-key");
  const keyStatus = document.querySelector("#copilot-key-backend-status");
  const keyResult = document.querySelector("#copilot-key-result");
  const thread = document.querySelector("#copilot-thread");
  const input = document.querySelector("#copilot-input");
  const task = document.querySelector("#copilot-action");
  const fileInput = document.querySelector("#copilot-file");
  const cameraInput = document.querySelector("#copilot-camera");
  const attachmentRoot = document.querySelector("#copilot-attachment");
  const status = document.querySelector("#copilot-status");
  const sendButton = document.querySelector("#copilot-send");
  const micButton = document.querySelector("#copilot-mic");
  let attachment = null;
  let attachments = [];
  let voiceAudio = null;
  let voiceAudioName = "";
  let attachmentFromCamera = false;
  let attachmentUrls = [];
  let review = null;
  let activeDraft = null;
  let customerPreparationScope = null;
  let preparedConversation = null;
  let operationBusy = false;
  let recorder = null;
  let recordingStream = null;
  let recordingChunks = [];
  let retryAction = null;
  let operationVersion=0, recordingVersion=0, recordingTimer=null, recordingBytes=0;
  const conversation = createCopilotConversation();
  const quoteVersions = new Map();

  document.querySelector("#copilot-close").innerHTML = icon("close");
  document.querySelector("#copilot-key-close").innerHTML = icon("close");
  document.querySelector("#copilot-attach").innerHTML = icon("paperclip");
  document.querySelector("#copilot-camera-button").innerHTML = icon("camera");
  micButton.innerHTML = icon("mic");
  sendButton.innerHTML = icon("send");

  function scrollThread() { requestAnimationFrame(() => thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" })); }
  function appendMessage(role, body, className = "") {
    const message = document.createElement("div");
    message.className = `chat-message ${role} ${className}`.trim();
    message.innerHTML = role === "assistant" ? `<span class="assistant-mark">${icon("sparkles")}</span><div class="message-body" dir="auto">${body}</div>` : `<div class="message-body" dir="auto">${body}</div>`;
    thread.append(message); scrollThread(); return message;
  }
  function welcome() {
    thread.innerHTML = "";
    appendMessage("assistant", `<p><strong>حاجی صاحب، گاہک کی پرچی بھیج دیں۔</strong></p><p>گاہک کا نام، برانڈ اور رعایت ساتھ بتا دیں؛ فعال ریٹ لسٹ کے مطابق مکمل ایسٹیمیٹ کا پری ویو تیار کر دوں گا۔ ایک ساتھ 10 تصاویر یا PDF بھیج سکتے ہیں۔</p><div class="prompt-chips"><button type="button" data-prompt="Dura Max PPR-C Pipe 25mm کا موجودہ نرخ بتائیں">موجودہ نرخ</button><button type="button" data-task="estimate" data-prompt="Dura Max کی پرچی کا مکمل ایسٹیمیٹ تیار کریں">نیا ایسٹیمیٹ</button><button type="button" data-task="purchase" data-prompt="اس سپلائر بل کی پڑتال کریں">سپلائر بل</button></div>`);
  }
  function setBusy(busy, message = "") {
    operationBusy = busy;
    sendButton.disabled = busy; task.disabled = busy; input.disabled = busy;
    micButton.disabled=busy;
    document.querySelector("#copilot-attach").disabled=busy;document.querySelector("#copilot-camera-button").disabled=busy;
    status.hidden = !busy; status.innerHTML = busy ? `<span class="spinner"></span>${escapeHtml(message)}` : "";
  }
  function clearAttachment() {
    attachmentUrls.forEach(url=>URL.revokeObjectURL(url));
    attachmentUrls = []; attachments=[]; attachment = null; voiceAudio = null; voiceAudioName = ""; attachmentFromCamera = false; fileInput.value = ""; cameraInput.value = ""; attachmentRoot.hidden = true; attachmentRoot.innerHTML = "";
  }
  function renderAttachments() {
    attachmentUrls.forEach(url=>URL.revokeObjectURL(url));attachmentUrls=[];
    const slips=attachments.map((file,index)=>{
      let preview;
      if(file.type.startsWith("image/")){const url=URL.createObjectURL(file);attachmentUrls.push(url);preview=`<img src="${url}" alt="پرچی ${index+1}" />`;}
      else preview=`<span class="attachment-icon">${icon("file")}</span>`;
      return `<div class="attachment-file">${preview}<span><strong>${escapeHtml(file.name||`پرچی ${index+1}`)}</strong><small>${escapeHtml(attachmentLabel(file))}</small></span><button class="icon-button" type="button" data-remove-slip="${index}" aria-label="پرچی ہٹائیں">${icon("close")}</button></div>`;
    }).join("");
    const voice=voiceAudio?`<div class="attachment-file voice-attachment"><span class="attachment-icon voice-waveform" aria-label="صوتی پیغام منسلک ہے">${icon("mic")}<i></i><i></i><i></i><i></i></span><span><strong>${escapeHtml(voiceAudioName||"صوتی پیغام")}</strong><small>${escapeHtml(attachmentLabel({name:voiceAudioName,size:voiceAudio.size}))}</small></span><button class="icon-button" type="button" data-remove-voice aria-label="صوتی پیغام ہٹائیں">${icon("close")}</button></div>`:"";
    attachmentRoot.innerHTML=slips+voice;attachmentRoot.hidden=!attachments.length&&!voiceAudio;
    attachment=attachments[0]??(voiceAudio?{type:voiceAudio.type,size:voiceAudio.size,name:voiceAudioName}:null);
  }
  function addAttachments(files,fromCamera=false) {
    try {
      const incoming=files.map(file=>({file,mimeType:validateAttachment(file)}));
      const incomingVoice=incoming.filter(item=>item.mimeType.startsWith("audio/"));
      const incomingSlips=incoming.filter(item=>!item.mimeType.startsWith("audio/"));
      if(incomingVoice.length>1||(incomingVoice.length&&voiceAudio))throw new Error("ایک پیغام کے ساتھ صرف ایک صوتی نوٹ شامل کریں۔");
      if(attachments.length+incomingSlips.length>10)throw new Error("ایک ساتھ زیادہ سے زیادہ 10 پرچیاں منتخب کریں۔");
      if([...attachments,...incomingSlips.map(item=>item.file)].reduce((sum,file)=>sum+file.size,0)+(voiceAudio?.size??0)+incomingVoice.reduce((sum,item)=>sum+item.file.size,0)>MAX_MEDIA_BYTES)throw new Error("تمام فائلوں کا مجموعی حجم 8 MB تک رکھیں۔");
      attachments=[...attachments,...incomingSlips.map(item=>item.file)];
      if(incomingVoice.length){voiceAudio=incomingVoice[0].file;voiceAudioName=voiceAudio.name||"صوتی پیغام";}
      if(fromCamera)attachmentFromCamera=true;
    }catch(error){showError(error);return;}
    renderAttachments();
  }
  function showError(error, action = null) {
    const original=error?.message??"";
    const message = /[\u0600-\u06ff]/u.test(error?.message??"") ? error.message :
      error?.code==="AI_API_KEY_REJECTED"?"جناب، Gemini کی کلید قبول نہیں ہوئی؛ API ترتیبات میں درست کلید درج کر دیں۔":
      error?.code==="AI_PROVIDER_RATE_LIMITED"||/rate limit|quota/iu.test(original)?"جناب، AI کی عارضی حد پوری ہے؛ گفتگو اور فائلیں برقرار ہیں، کچھ دیر بعد دوبارہ کوشش کریں۔":
      /workspace changed/iu.test(original)?"جناب، فعال ورک اسپیس بدل گیا ہے؛ اسی ورک اسپیس میں دوبارہ درخواست بھیج دیں۔":
      /original user and workspace/iu.test(original)?"جناب، یہ مسودہ اسی اصل صارف اور ورک اسپیس سے منظور کریں جہاں تیار ہوا تھا۔":
      /draft.s workspace/iu.test(original)?"جناب، منظوری سے پہلے اس مسودے کی اصل ورک اسپیس اور برانچ پر واپس آ جائیں۔":
      /name.*phone.*city.*required/iu.test(original)?"جناب، نئے گاہک کے لیے نام، فون نمبر اور شہر یا پتہ درج کر دیں۔":
      /go online/iu.test(original)?"جناب، ریکارڈ محفوظ کرنے سے پہلے انٹرنیٹ سے رابطہ بحال کر لیں۔":
      /attachment is empty/iu.test(original)?"جناب، منتخب فائل خالی ہے؛ درست پرچی یا صوتی پیغام منتخب کر لیں۔":
      /use a jpeg|unsupported.*file/iu.test(original)?"جناب، تصویر JPEG، PNG، WebP یا PDF میں بھیج دیں؛ صوتی فائل الگ بھیجیں۔":
      /8 MB/iu.test(original)?"جناب، فائلوں کا مجموعی حجم 8 MB تک رکھیں۔":
      /codec|microphone|recording/iu.test(original)?"جناب، صوتی ریکارڈنگ شروع نہیں ہو سکی؛ مائیک کی اجازت اور معاون صوتی فارمیٹ دیکھ لیں۔":
      /sign in/iu.test(original)?"جناب، ERP تک رسائی کے لیے پہلے لاگ اِن کر لیں۔":
      /choose.*workspace/iu.test(original)?"جناب، پہلے اپنی فعال ورک اسپیس منتخب کر لیں۔":
      copilotRecoveryMessage(error);
    retryAction = action;
    appendMessage("assistant", `<div class="review-card copilot-recovery" role="status">${icon("alert")}<span><p>${escapeHtml(message)}</p><p>اسی گفتگو میں درست تفصیل یا اگلا قدم بتا دیں۔</p>${action ? '<button class="button secondary compact" type="button" data-copilot-retry>اسی قدم کی دوبارہ پڑتال</button>' : ""}</span></div>`);
    if (error?.code === "AI_API_KEY_REJECTED" || error?.code === "AI_NOT_CONFIGURED") void openKeySettings();
  }
  function contextOrThrow() {
    if (!getAuthenticatedUserId()) throw new Error("Sign in before asking Copilot to access ERP data.");
    const context = getWorkspaceContext();
    if (!context) throw new Error("Choose your workspace before using Copilot.");
    return context;
  }
  async function refreshProviderStatus() {
    const hasLocalKey = Boolean(getCopilotApiKey());
    keyStatus.textContent = "Checking for a server-side AI key…";
    try {
      const response = await getCopilotProviderStatus();
      const serverConfigured = response.data?.serverConfigured === true;
      keyStatus.textContent = hasLocalKey
        ? `A Gemini key is saved in this browser and will be used${serverConfigured ? "; it overrides the server-side key." : "."}`
        : serverConfigured
          ? "A server-side AI key is configured. No browser key is needed."
          : "Basic stock inquiries work without an AI key. Enter your Gemini API key to activate conversational workflows.";
      return serverConfigured;
    } catch {
      keyStatus.textContent = hasLocalKey
        ? "A Gemini key is saved here. The server-side key status could not be checked."
        : "The server-side key status could not be checked. You can still add a Gemini key here.";
      return null;
    }
  }
  async function openKeySettings() {
    keyInput.value = "";
    keyResult.hidden = true;
    if (!keyDialog.open) keyDialog.showModal();
    await refreshProviderStatus();
    keyInput.focus();
  }
  async function checkKeyOnCopilotOpen() {
    if (getCopilotApiKey()) return;
    const serverConfigured = await refreshProviderStatus();
    if (serverConfigured === false && !keyDialog.open) await openKeySettings();
  }
  function collectLines() {
    const rows = [...thread.querySelectorAll("[data-review-card] [data-review-line]")];
    if (!rows.length) throw new Error("No transaction lines were extracted.");
    return rows.map((row, index) => {
      const productId = Number(row.querySelector("[data-line-product]")?.value);
      const quantity = Number(row.querySelector("[data-line-quantity]")?.value);
      const unit = row.querySelector("[data-line-unit]")?.value.trim();
      const rawRate = row.querySelector("[data-line-rate]")?.value.trim();
      const rawRateList = row.querySelector("[data-line-rate-list]")?.value;
      if (!Number.isInteger(productId) || productId <= 0) throw new Error(`Choose a verified product for line ${index + 1}.`);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Enter a valid quantity for line ${index + 1}.`);
      if (review.intent === "estimate" && (!review.lines[index]?.resolvedPrice || review.lines[index].product.selectedId !== productId || review.lines[index].quantity !== quantity || review.lines[index].unit !== unit || (rawRateList && review.lines[index].resolvedPrice.rate_list_id !== Number(rawRateList)))) throw new Error(`Refresh and verify the authorized sale rate for line ${index + 1}.`);
      return { productName: review.lines[index]?.productName || "Product", productId, quantity, ...(unit ? { unit } : {}), ...(rawRate ? { unitRate: Number(rawRate) } : {}), ...(rawRateList ? { rateListId: Number(rawRateList) } : {}) };
    });
  }
  function selectedMatch(name) { const raw = thread.querySelector(`[data-match="${name}"]`)?.value; return raw ? Number(raw) : undefined; }

  function refreshReviewControls() {
    const card = thread.querySelector("[data-review-card]");
    if (!card || !review) return;
    const blocked = review.lines.some((line) => line.warnings.length || (review.intent === "estimate" && !line.resolvedPrice)) || [review.customer, review.vendor, review.warehouse].some((match) => match?.status === "ambiguous" || match?.status === "unresolved");
    card.querySelector("[data-review-notice]").hidden = !blocked;
    card.querySelector("[data-prepare-draft]").disabled = blocked;
  }

  async function refreshLineQuote(row) {
    if (!review) return;
    const index = Number(row.dataset.reviewLine);
    const line = review.lines[index];
    const productId = Number(row.querySelector("[data-line-product]")?.value);
    const quantity = Number(row.querySelector("[data-line-quantity]")?.value);
    const unit = row.querySelector("[data-line-unit]")?.value.trim();
    const rateListId = Number(row.querySelector("[data-line-rate-list]")?.value);
    const version = (quoteVersions.get(index) ?? 0) + 1;
    quoteVersions.set(index, version);
    selectReviewProduct(line, productId);
    line.quantity = quantity;
    line.unit = unit;
    line.rateList.selectedId = rateListId || undefined;
    line.resolvedPrice = undefined;
    line.amount = undefined;
    line.warnings = line.warnings.filter((warning) => !/Multiple products match|Product could not be matched|sale rate|Rate List|rate context|unit conversion|Quantity is missing|Unit is missing/i.test(warning));
    if (!Number.isFinite(quantity) || quantity <= 0) line.warnings.push("Quantity is missing or unclear.");
    if (!unit) line.warnings.push("Unit is missing or unclear.");
    if (review.intent === "estimate" && line.rateList.input && !rateListId) line.warnings.push(`Sale Rate List '${line.rateList.input}' could not be verified; choose an active sale Rate List.`);
    refreshReviewControls();
    if (review.intent === "estimate" && productId && quantity > 0 && unit && (!line.rateList.input || rateListId)) {
      try {
        const context = contextOrThrow();
        const response = await quoteCopilotEstimateLine({ organizationId: context.organizationId, userId: getAuthenticatedUserId(), productId, quantity, unit, ...(rateListId ? { rateListId } : {}), ...(selectedMatch("customer") ? { customerId: selectedMatch("customer") } : {}) }, context.branchId);
        if (quoteVersions.get(index) !== version || !review) return;
        line.resolvedPrice = response.data.resolvedPrice ?? undefined;
        line.amount = response.data.amount ?? undefined;
        if (response.data.warning) line.warnings.push(response.data.warning);
        if (line.resolvedPrice) {
          line.rateList.selectedId = line.resolvedPrice.rate_list_id;
          line.rateList.status = "matched";
          if (!line.rateList.candidates.some((candidate) => candidate.id === line.resolvedPrice.rate_list_id)) line.rateList.candidates.unshift({ id: line.resolvedPrice.rate_list_id, label: `Sale Rate List ${line.resolvedPrice.rate_list_id}`, confidence: 1 });
        }
      } catch (error) {
        if (quoteVersions.get(index) !== version || !review) return;
        line.warnings.push(error instanceof Error ? error.message : "Sale rate could not be verified.");
      }
    }
    if (quoteVersions.get(index) !== version || !review) return;
    row.outerHTML = reviewLineMarkup(line, index, review.intent);
    refreshReviewControls();
  }

  async function analyze(selection, submission) {
    if (operationBusy) return;
    const context = contextOrThrow();
    const text = submission?.text??input.value.trim();
    const files=submission?.files??attachments, audio=submission?.audio??voiceAudio, audioName=submission?.audioName??voiceAudioName;
    const camera=submission?.camera??attachmentFromCamera;
    if(submission&&(submission.userId!==getAuthenticatedUserId()||submission.organizationId!==context.organizationId||submission.branchId!==context.branchId))throw new Error("Workspace changed. Please resend in the active workspace.");
    if (!text && !files.length && !audio) throw new Error("Write a message or add an attachment first.");
    const action = submission?.action??task.value;
    const source = files.length ? sourceForAttachment(files[0], camera) : audio ? "voice" : "text";
    if(recorder?.state==="recording") throw new Error("Stop recording before sending.");
    const display = text || (source === "voice" ? "Voice note" : fromCameraLabel(source));
    appendMessage("user", `<p>${escapeHtml(display)}</p>${files.map(file=>`<small>${escapeHtml(attachmentLabel(file))}</small>`).join("")}${audio?`<small>♫ ${escapeHtml(audioName||"صوتی پیغام")}</small>`:""}`);
    const sentAttachment = files[0];
    const sentAttachments=[...files];
    const sentVoiceAudio=audio;
    const sentVoiceAudioName=audioName;
    const snapshot={text,files:sentAttachments,audio:sentVoiceAudio,audioName:sentVoiceAudioName,camera,action,userId:getAuthenticatedUserId(),organizationId:context.organizationId,branchId:context.branchId};
    const restoreSubmission=()=>{
      const current=getWorkspaceContext();
      if(getAuthenticatedUserId()!==snapshot.userId||current?.organizationId!==snapshot.organizationId||current?.branchId!==snapshot.branchId)return;
      if(!attachments.length&&!voiceAudio){attachments=[...sentAttachments];voiceAudio=sentVoiceAudio;voiceAudioName=sentVoiceAudioName;attachmentFromCamera=camera;renderAttachments();}
      if(!input.value)input.value=text;
    };
    input.value="";input.style.height="auto";clearAttachment();
    const version=++operationVersion;
    let acceptedForConversation=false;
    setBusy(true, source === "voice" ? "Transcribing audio, then processing with the ERP Agent" : source!=="text"?"Reading document, resolving ERP entities and processing the draft":"ERP Agent processing your request");
    try {
      const encodedAttachments=await Promise.all(sentAttachments.map(async file=>({fileName:file.name,media:await readFileAsBase64(file)})));
      const encodedVoice=sentVoiceAudio?{fileName:sentVoiceAudioName||"voice-note.webm",media:await readFileAsBase64(new File([sentVoiceAudio],sentVoiceAudioName||"voice-note.webm",{type:sentVoiceAudio.type}))}:null;
      const combinedAttachments=[...encodedAttachments,...(encodedVoice?[encodedVoice]:[])];
      const payload = { organizationId: context.organizationId, userId: getAuthenticatedUserId(), source, ...(text ? { text } : {}), ...(encodedAttachments[0] ? { media: encodedAttachments[0].media } : encodedVoice?.media ? {media:encodedVoice.media}: {}) };
      const mediaInput=combinedAttachments.length>1 ? {attachments:combinedAttachments} : {media:combinedAttachments[0]?.media??payload.media,fileName:combinedAttachments[0]?.fileName??sentAttachment?.name};
      if (action === "auto" || action === "estimate" || (action === "rate_list_update" && sentAttachment)) {
        const userId = getAuthenticatedUserId();
        const token = conversation.tokenFor(userId, context.organizationId, context.branchId);
        const conversationId = conversation.idFor(userId, context.organizationId, context.branchId);
        activeDraft = null; preparedConversation = null; customerPreparationScope = null;
        thread.querySelectorAll("[data-customer-preparation], [data-conversation-draft], [data-conversation-payment], [data-agent-ambiguity], [data-input-review], .confirmation-card").forEach(card => card.remove());
        const response = source==="text"?await askCopilot(text, context.organizationId, context.branchId, token, conversationId, selection):await askCopilotMedia({source,...mediaInput,...(text?{message:text}:{}),task:action,...(token?{conversationToken:token}:{}),...(conversationId?{conversationId}:{})},context.organizationId,context.branchId);
        if(version!==operationVersion) return;
        const current=getWorkspaceContext();
        if(getAuthenticatedUserId()!==userId || current?.organizationId!==context.organizationId || current?.branchId!==context.branchId) {conversation.clear();throw new Error("Workspace changed. Please resend in the active workspace.");}
        if (typeof response.data?.answer !== "string") throw new Error("Copilot did not return an answer.");
        // A failed planning turn has not handed the slip to a usable draft.
        // Keep its files and wording available for correction or an exact retry.
        const retryable=["rate_limited","error","timeout","empty","limit","call_limit","malformed","duplicate"].includes(response.data.status);
        const needsMedia=retryable || (response.data.status==="clarification" && !response.data.review && !response.data.draft);
        if(needsMedia)restoreSubmission();
        acceptedForConversation=!needsMedia;
        if(!needsMedia){input.value="";input.style.height="auto";clearAttachment();}
        conversation.accept(response.data.conversationToken, userId, context.organizationId, context.branchId, response.data.conversationId);
        activeDraft = null; preparedConversation = null;
        appendMessage("assistant",formatCopilotAnswer(response.data.answer));
        if(retryable && response.data.status!=="rate_limited"){
          retryAction=()=>analyze(selection,snapshot);
          appendMessage("assistant",'<div class="review-card copilot-recovery"><p>گفتگو اور منتخب فائلیں اسی قدم کی دوبارہ پڑتال کے لیے موجود ہیں۔</p><button class="button secondary compact" type="button" data-copilot-retry>اسی قدم کی دوبارہ پڑتال</button></div>');
        }
        if (response.data.status !== "rate_limited" && response.data.preparation?.intent === "customer_create") {
          customerPreparationScope = { ...context, userId };
          appendMessage("assistant", customerPreparationMarkup());
        }
        if (response.data.status !== "rate_limited" && response.data.review?.intent === "customer_create") {
          activeDraft = customerDraftState(response.data.review, context, userId);
          appendMessage("assistant", customerDraftReviewMarkup(response.data.review));
        }
        if(response.data.review?.intent==="erp_action" && response.data.status!=="rate_limited") {
          const prepared=response.data.review;
          activeDraft=prepared.requiresConfirmation===false?null:{id:prepared.draftId,idempotencyKey:prepared.idempotencyKey,intent:prepared.tool==="erp_create_estimate"?"estimate":prepared.tool,organizationId:context.organizationId,branchId:context.branchId,userId};
          appendMessage("assistant",erpActionReviewMarkup(prepared));
        }
        if(response.data.extraction) appendMessage("assistant",extractionMarkup(response.data.extraction,response.data.reviewText));
        if (response.data.catalogReview) {
          const catalog = response.data.catalogReview;
          activeDraft = { id: catalog.draftId, idempotencyKey: catalog.idempotencyKey, intent: "rate_list_update", organizationId: context.organizationId, branchId: context.branchId, userId, catalogName: catalog.name, itemCount: catalog.itemCount };
          task.value = "rate_list_update";
          appendMessage("assistant", '<article class="confirmation-card review-card"><p>تصدیق کے بعد تمام آئٹمز ERP میں درج ہوں گے اور یہ ریٹ لسٹ فعال ہو جائے گی۔</p><button type="button" class="button secondary" data-draft-cancel>منسوخ کریں</button><button type="button" class="button primary" data-confirm-draft>تصدیق کریں اور ریٹ لسٹ محفوظ کریں</button></article>');
        }
        if(response.data.clarification) appendMessage("assistant",ambiguityMarkup(response.data.clarification));
        if(response.data.reports)response.data.reports.forEach(report=>{const markup=depotReportMarkup(report);if(markup)appendMessage("assistant",markup);});
        if (response.data.draft) {
          appendMessage("assistant", conversationDraftMarkup(response.data.draft));
          if (response.data.status!=="rate_limited" && response.data.draft.prepared) preparedConversation = { token: response.data.conversationToken, conversationId: response.data.conversationId };
        }
        if (response.data.status!=="rate_limited" && response.data.paymentPreparation) {
          appendMessage("assistant", conversationPaymentMarkup(response.data.paymentPreparation));
          preparedConversation = { token: response.data.conversationToken, conversationId: response.data.conversationId, kind: "payment" };
        }
        if(response.data.status==="rate_limited") {
          showError(new Error("The AI provider is temporarily rate limited. Your message and attachment are ready to retry."),()=>analyze(selection,snapshot));
          return;
        }
        return;
      }
      if (action === "invoice_extract") {
        const response = await extractInvoiceDocument(payload, context.branchId);
        input.value="";input.style.height="auto";clearAttachment();
        const extraction = response.data;
        appendMessage("assistant", `<article class="review-card"><div class="review-heading"><div><span class="status-pill neutral">Extraction only</span><h3>Invoice review</h3></div></div><p>${extraction.lines?.length ?? 0} line(s) extracted. This does not create or post an invoice.</p><div class="review-lines">${(extraction.lines ?? []).map((line, index) => `<div class="review-line"><div class="review-line-title"><span>${index + 1}</span><strong>${escapeHtml(line.productName?.value ?? line.productName ?? "Unrecognized item")}</strong></div></div>`).join("")}</div><div class="review-actions"><button class="button secondary" type="button" data-review-cancel>Close review</button></div></article>`);
        return;
      }
      payload.intent = action === "auto" ? "auto" : apiIntent(action);
      const response = await createCopilotReview(payload, context.branchId);
      input.value="";input.style.height="auto";clearAttachment();
      thread.querySelector("[data-review-card]")?.remove();
      review = response.data;
      quoteVersions.clear();
      appendMessage("assistant", reviewCardMarkup(review));
    } catch(error) {if(version===operationVersion){if(!acceptedForConversation)restoreSubmission();showError(error,()=>analyze(selection,snapshot));}}
    finally { if(version===operationVersion) setBusy(false); }
  }
  function fromCameraLabel(source) { return source === "camera" ? "Photo for review" : source === "image" ? "Attachment for review" : "ERP request"; }

  async function prepareDraft() {
    const context = contextOrThrow();
    if (!review) throw new Error("Ask Copilot to prepare a review first.");
    const lines = collectLines();
    const source = review.source;
    setBusy(true, "Preparing a protected draft");
    try {
      const idempotencyKey = `copilot-draft-${crypto.randomUUID()}`;
      if (review.intent === "rate_list_update") {
        const rateListId = lines.find((line) => line.rateListId)?.rateListId;
        if (!rateListId) throw new Error("Choose a verified rate list before preparing this draft.");
        const versionNumber = Number(fieldValue(review.proposal?.versionNumber));
        const effectiveFrom = fieldValue(review.proposal?.effectiveFrom);
        if (!Number.isInteger(versionNumber) || !effectiveFrom) throw new Error("The backend did not provide a version and effective date. Review this update in the Rate Lists module.");
        const response = await createCopilotRateListDraft({ organizationId: context.organizationId, userId: getAuthenticatedUserId(), source, rateListId, versionNumber, effectiveFrom, lines: lines.map((line) => ({ productName: line.productName, productId: line.productId, minimumQuantity: line.quantity, unit: line.unit, unitRate: line.unitRate })) }, context.branchId, idempotencyKey);
        activeDraft = { id: response.data.id, organizationId: context.organizationId, branchId: context.branchId, idempotencyKey, intent: review.intent };
      } else {
        const payload = { organizationId: context.organizationId, userId: getAuthenticatedUserId(), intent: review.intent, source, customerId: selectedMatch("customer") ? String(selectedMatch("customer")) : undefined, vendorId: selectedMatch("vendor") ? String(selectedMatch("vendor")) : undefined, warehouseId: selectedMatch("warehouse"), documentNumber: fieldValue(review.proposal?.documentNumber), documentDate: fieldValue(review.proposal?.documentDate), currencyCode: fieldValue(review.proposal?.currencyCode), lines, confidence: review.confidence ?? 1 };
        if (!navigator.onLine) {
          await queueJsonRequest({ endpoint: "/api/v1/ai/copilot/drafts", method: "POST", headers: { "X-Branch-Id": context.branchId, "Idempotency-Key": idempotencyKey }, body: payload, kind: "copilot-draft" });
          appendMessage("assistant", `<div class="message-success">${icon("check")}<span><strong>Draft queued offline</strong><p>It will be sent when the connection returns. Confirmation still requires an online session.</p></span></div>`);
          review = null; return;
        }
        const response = await createCopilotDraft(payload, context.branchId, idempotencyKey);
        if (review.intent === "inventory_adjustment") {
          appendMessage("assistant", `<div class="message-success">${icon("check")}<span><strong>Proposal saved</strong><p>Authoritative inventory execution remains unavailable until the accounting-safe transaction service is present.</p></span></div>`);
          review = null; return;
        }
        activeDraft = { id: response.data.id, organizationId: context.organizationId, branchId: context.branchId, idempotencyKey, intent: review.intent };
      }
      appendMessage("assistant", `<article class="confirmation-card"><span class="confirmation-icon">${icon("check", 22)}</span><div><p class="eyebrow">Draft ready</p><h3>${escapeHtml(humanIntent(review.intent))}</h3><p>The draft has been validated. Confirm only after checking the review above.</p><div class="review-actions"><button class="button secondary" type="button" data-draft-cancel>Cancel</button><button class="button danger" type="button" data-confirm-draft>Confirm action</button></div></div></article>`);
      review = null;
    } finally { setBusy(false); }
  }

  async function prepareCustomer(card) {
    if (operationBusy) return;
    const context = contextOrThrow();
    if (!card || !customerPreparationScope) throw new Error("No customer preparation is waiting for details.");
    if (customerPreparationScope.userId !== getAuthenticatedUserId() || customerPreparationScope.organizationId !== context.organizationId || customerPreparationScope.branchId !== context.branchId) throw new Error("Return to the original user and workspace before preparing this customer.");
    const details = Object.fromEntries(["name", "phone", "city"].map(name => [name, card.querySelector('[name="' + name + '"]')?.value?.trim() ?? ""]));
    if (Object.values(details).some(value => !value)) throw new Error("Name, phone number, and city are required to prepare a customer review.");
    input.value = "Prepare a new customer for review: " + JSON.stringify(details);
    task.value = "auto";
    await analyze();
  }

  async function confirmDraft() {
    if (operationBusy) return;
    if (!activeDraft) throw new Error("No draft is waiting for confirmation.");
    const context = getWorkspaceContext();
    if (activeDraft.userId && activeDraft.userId !== getAuthenticatedUserId()) throw new Error("Return to the original user and workspace before confirming this customer.");
    if (context.organizationId !== activeDraft.organizationId || context.branchId !== activeDraft.branchId) throw new Error("Return to the draft's workspace and branch before confirming.");
    if (!navigator.onLine) throw new Error("Go online before confirming an ERP action.");
    setBusy(true, "Confirming with the authoritative ERP service");
    try {
      const response = await confirmCopilotDraft({ ...activeDraft, userId: getAuthenticatedUserId() });
      const completed = activeDraft;
      activeDraft = null;
      conversation.clear(); preparedConversation = null;
      if (completed.catalogName && response.verified) {
        task.value = "auto";
        appendMessage("assistant", `<p class="message-success">${escapeHtml(completed.catalogName)} کی تمام ${completed.itemCount} آئٹمز ERP میں کامیابی سے درج کر دی گئی ہیں۔</p>`);
      }
      appendMessage("assistant", `<div class="${response.verified ? "message-success" : "message-status"}">${icon(response.verified ? "check" : "alert")}<span><strong>${response.verified ? "Verified in ERP" : "Action not verified"}</strong><p>${response.verified ? "The ERP service executed this action and an independent read confirmed the resulting record." : "The resulting ERP record has not been verified. Check the action status before continuing."}</p>${response.verified ? '<button class="button secondary compact" type="button" data-open-record>Open in ERP</button>' : ""}</span></div>`);
      const button = thread.querySelector("[data-open-record]:last-of-type");
      if (button) { button.dataset.intent = completed.intent; button.dataset.recordId = String(response.data?.result?.id ?? response.data?.result?.purchase?.id ?? response.data?.result?.credit_note?.id ?? ""); }
    } finally { setBusy(false); }
  }

  async function prepareStatefulDraft() {
    if (operationBusy) return;
    const context = getWorkspaceContext();
    const userId = getAuthenticatedUserId();
    if (!preparedConversation || conversation.tokenFor(userId, context.organizationId, context.branchId) !== preparedConversation.token) throw new Error("Review the current conversation draft first.");
    if (!navigator.onLine) throw new Error("Go online before preparing an ERP approval draft.");
    const payment = preparedConversation.kind === "payment";
    const version = ++operationVersion;
    setBusy(true, payment ? "Preparing the reviewed payment" : "Preparing the reviewed estimate");
    try {
      const prepare = payment ? prepareConversationPayment : prepareConversationDraft;
      const response = await prepare(preparedConversation.token, preparedConversation.conversationId, context.organizationId, context.branchId);
      if (version !== operationVersion) return;
      const current = getWorkspaceContext();
      if (getAuthenticatedUserId() !== userId || current.organizationId !== context.organizationId || current.branchId !== context.branchId) throw new Error("Workspace changed. Review the current conversation again.");
      activeDraft = { id: response.data.id, organizationId: context.organizationId, branchId: context.branchId, idempotencyKey: response.data.idempotencyKey, intent: payment ? response.paymentPreparation.intent : "estimate" };
      thread.querySelectorAll("[data-conversation-draft], [data-conversation-payment]").forEach(card => card.remove());
      appendMessage("assistant", payment ? conversationPaymentMarkup(response.paymentPreparation, true) : conversationDraftMarkup(response.draft));
      preparedConversation = null;
      thread.querySelectorAll(".confirmation-card").forEach(card => card.remove());
      appendMessage("assistant", `<article class="confirmation-card"><h3>${payment ? "Payment" : "Estimate"} ready for confirmation</h3><p>${payment ? "Review the party, payment direction, amount, date, method and allocations above." : "Review the customer, items, rates, discount and total above."} Confirm action to execute through the ERP service.</p><div class="review-actions"><button class="button secondary" type="button" data-draft-cancel>Cancel</button><button class="button danger" type="button" data-confirm-draft>Confirm action</button></div></article>`);
    } finally { if (version === operationVersion) setBusy(false); }
  }

  async function toggleRecording() {
    if (recorder?.state === "recording") { recorder.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Voice recording is not supported by this browser.");
    const version=++recordingVersion;
    setBusy(true,"Requesting microphone access");
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(version!==recordingVersion) {stream.getTracks().forEach(track=>track.stop());return;}
      recordingStream=stream;recordingChunks=[];recordingBytes=0;
      const mimeType=["audio/webm;codecs=opus","audio/mp4","audio/ogg;codecs=opus"].find(type=>MediaRecorder.isTypeSupported?.(type));
      const active=new MediaRecorder(stream,mimeType?{mimeType}:undefined);recorder=active;
      active.addEventListener("dataavailable",event=>{
        if(event.data.size) {recordingChunks.push(event.data);recordingBytes+=event.data.size;}
        if(recordingBytes>MAX_MEDIA_BYTES && active.state==="recording") active.stop();
      });
      const cleanup=()=>{stream.getTracks().forEach(track=>track.stop());if(version!==recordingVersion) return;clearTimeout(recordingTimer);if(recordingStream===stream) recordingStream=null;micButton.classList.remove("recording");micButton.innerHTML=icon("mic");micButton.setAttribute("aria-label","Record voice");};
      active.addEventListener("error",()=>{cleanup();if(version!==recordingVersion) return;recordingVersion++;setBusy(false);showError(new Error("Recording failed. Please record again."));});
      active.addEventListener("stop",()=>{
        cleanup();
        if(version!==recordingVersion) return;
        setBusy(false);
        if(recordingBytes>MAX_MEDIA_BYTES) {showError(new Error("Recording exceeds 8 MB. Please record a shorter message."));return;}
        const type=(active.mimeType||mimeType||"audio/webm").split(";")[0];
        voiceAudio=new Blob(recordingChunks,{type});voiceAudioName=`voice-${Date.now()}.${type==="audio/mp4"?"m4a":type==="audio/ogg"?"ogg":"webm"}`;renderAttachments();
      });
      active.start(1000);setBusy(false);sendButton.disabled=true;task.disabled=true;
      recordingTimer=setTimeout(()=>{if(active.state==="recording") active.stop();},60_000);
      micButton.classList.add("recording");micButton.innerHTML=icon("stop");micButton.setAttribute("aria-label","Stop recording");status.hidden=false;status.textContent="Recording voice note (up to 60 seconds). Select stop when finished.";
    } catch(error) {recordingStream?.getTracks().forEach(track=>track.stop());recordingStream=null;throw error;}
    finally {if(version===recordingVersion && recorder?.state!=="recording") setBusy(false);}
  }

  async function run(action) { try { retryAction = null; await action(); } catch (error) { setBusy(false); showError(error, action); } }
  function reset() { operationVersion++;recordingVersion++;clearTimeout(recordingTimer);if (recorder?.state === "recording") recorder.stop();recordingStream?.getTracks().forEach(track=>track.stop());recordingStream=null; clearAttachment(); review = null; activeDraft = null; customerPreparationScope = null; preparedConversation = null; retryAction = null; conversation.clear(); input.value = ""; task.value = "auto"; status.hidden = true; setBusy(false); welcome(); }

  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 150)}px`; });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void run(analyze); } });
  sendButton.addEventListener("click", () => void run(analyze));
  task.addEventListener("change", () => { if (!["auto", "estimate"].includes(task.value)) { conversation.clear(); preparedConversation = null; } });
  document.querySelector("#copilot-attach").addEventListener("click", () => fileInput.click());
  document.querySelector("#copilot-camera-button").addEventListener("click", () => cameraInput.click());
  micButton.addEventListener("click", () => void run(toggleRecording));
  fileInput.addEventListener("change", () => { if (fileInput.files?.length) addAttachments(Array.from(fileInput.files));fileInput.value=""; });
  cameraInput.addEventListener("change", () => { if (cameraInput.files?.[0]) addAttachments([cameraInput.files[0]], true);cameraInput.value=""; });
  attachmentRoot.addEventListener("click", (event) => { const slip=event.target.closest("[data-remove-slip]");const voice=event.target.closest("[data-remove-voice]");if(slip){attachments=attachments.filter((_,index)=>index!==Number(slip.dataset.removeSlip));renderAttachments();}if(voice){voiceAudio=null;voiceAudioName="";renderAttachments();} });
  thread.addEventListener("click", (event) => {
    const cardButton=event.target.closest("[data-copy-quotation], [data-download-card]");
    if(cardButton){
      const text=cardButton.closest("details").querySelector("[data-customer-quotation]").textContent;
      if(cardButton.hasAttribute("data-download-card"))void run(()=>downloadCustomerCard(text));
      else void run(async()=>{await navigator.clipboard.writeText(text);});
      return;
    }
    const candidate=event.target.closest("[data-agent-candidate]");
    if(candidate) {input.value="Continue the pending request using the selected ERP candidate.";void run(()=>analyze({kind:candidate.dataset.candidateKind,id:Number(candidate.dataset.agentCandidate)}));}
    if(event.target.closest("[data-use-reviewed-input]")) {
      const card=event.target.closest("[data-input-review]");
      input.value=card?.querySelector("[data-input-review-text]")?.value??"";clearAttachment();void run(analyze);
    }
    const prompt = event.target.closest("[data-prompt]");
    if (prompt) { if (prompt.dataset.task) { task.value = prompt.dataset.task; conversation.clear(); } input.value = prompt.dataset.prompt; input.focus(); }
    if (event.target.closest("[data-review-cancel]")) { review = null; quoteVersions.clear(); event.target.closest(".review-card")?.remove(); appendMessage("assistant", "<p>Review cancelled. No ERP data was changed.</p>"); }
    if (event.target.closest("[data-prepare-draft]")) void run(prepareDraft);
    if (event.target.closest("[data-prepare-conversation-draft]")) void run(prepareStatefulDraft);
    if (event.target.closest("[data-prepare-conversation-payment]")) void run(prepareStatefulDraft);
    if (event.target.closest("[data-prepare-customer]")) void run(() => prepareCustomer(event.target.closest("[data-customer-preparation]")));
    if (event.target.closest("[data-draft-cancel]")) { activeDraft = null; event.target.closest(".confirmation-card")?.remove(); appendMessage("assistant", "<p>Draft cancelled. Nothing was posted.</p>"); }
    if (event.target.closest("[data-confirm-draft]")) void run(confirmDraft);
    if (event.target.closest("[data-copilot-retry]") && retryAction) void run(retryAction);
    const open = event.target.closest("[data-open-record]");
    if (open && openNativeAction) { openNativeAction(open.dataset.intent, open.dataset.recordId); dialog.close(); }
  });
  thread.addEventListener("change", (event) => {
    if (!review) return;
    const row = event.target.closest("[data-review-line]");
    if (row && event.target.matches("[data-line-product], [data-line-quantity], [data-line-unit], [data-line-rate-list]")) void run(() => refreshLineQuote(row));
    else if (event.target.matches("[data-match]")) {
      const match = review[event.target.dataset.match];
      if (match) { match.selectedId = Number(event.target.value) || undefined; match.status = match.selectedId ? "matched" : "unresolved"; }
      refreshReviewControls();
      if (event.target.dataset.match === "customer" && review.intent === "estimate") thread.querySelectorAll("[data-review-card] [data-review-line]").forEach((lineRow) => void run(() => refreshLineQuote(lineRow)));
    }
  });
  document.querySelector("#copilot-close").addEventListener("click", () => {const wasRecording=recorder?.state==="recording";recordingVersion++;clearTimeout(recordingTimer);if(wasRecording) recorder.stop();recordingStream?.getTracks().forEach(track=>track.stop());recordingStream=null;micButton.classList.remove("recording");micButton.innerHTML=icon("mic");if(wasRecording) setBusy(false);dialog.close();});
  document.querySelector("#copilot-settings").addEventListener("click", () => void openKeySettings());
  document.querySelector("#copilot-key-close").addEventListener("click", () => keyDialog.close());
  document.querySelector("#copilot-key-cancel").addEventListener("click", () => keyDialog.close());
  document.querySelector("#copilot-key-test")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    keyResult.hidden = false;
    keyResult.dataset.state = "pending";
    keyResult.textContent = "Testing the saved key with the AI provider…";
    try {
      const result = await testCopilotProvider();
      keyResult.dataset.state = result.data?.connected === true ? "success" : "error";
      keyResult.textContent = result.data?.connected === true ? `AI connection verified. The provider accepted a text request${result.data.httpStatus ? ` (HTTP ${result.data.httpStatus})` : ""}.` : "The AI connection could not be verified.";
    } catch (error) {
      keyResult.dataset.state = "error";
      keyResult.textContent = error instanceof Error ? error.message : "The AI connection could not be verified.";
    } finally { button.disabled = false; }
  });
  document.querySelector("#copilot-key-clear").addEventListener("click", () => {
    clearCopilotApiKey(); keyInput.value = ""; keyResult.hidden = true;
    void refreshProviderStatus();
  });
  keyForm.addEventListener("submit", (event) => {
    event.preventDefault(); keyResult.hidden = true;
    try {
      saveCopilotApiKey(keyInput.value);
      keyInput.value = "";
      keyDialog.close();
    } catch (error) {
      keyResult.className = "form-message";
      keyResult.dataset.state = "error";
      keyResult.textContent = error instanceof Error ? error.message : "The API key could not be saved.";
      keyResult.hidden = false;
    }
  });
  function openCopilot() { if (!dialog.open) dialog.showModal(); input.focus(); void checkKeyOnCopilotOpen(); }
  document.querySelector("#copilot-button").addEventListener("click", openCopilot);
  welcome();
  return { open: openCopilot, reset };
}

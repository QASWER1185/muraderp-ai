import { createCopilotDraft, createCopilotReview, askCopilot, prepareConversationDraft, prepareConversationPayment, quoteCopilotEstimateLine, createCopilotRateListDraft, extractInvoiceDocument, confirmCopilotDraft } from "./copilot-api.js";
import { queueJsonRequest } from "./offline-sync.js";
import { getWorkspaceContext } from "./workspace-context.js";
import { icon } from "./icons.js";

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const CONVERSATION_MAX_AGE_MS = 29 * 60_000;

export function createCopilotConversation(now = Date.now) {
  let token = null;
  let scope = null;
  let expiresAt = 0;
  let conversationId = null;
  const key = (userId, organizationId, branchId) => JSON.stringify([userId, organizationId, branchId]);
  return {
    tokenFor(userId, organizationId, branchId) {
      const current = key(userId, organizationId, branchId);
      if (scope !== current || now() >= expiresAt) { token = null; conversationId = null; scope = current; }
      return token;
    },
    idFor(userId, organizationId, branchId) { this.tokenFor(userId, organizationId, branchId); return conversationId; },
    accept(value, userId, organizationId, branchId, id) {
      scope = key(userId, organizationId, branchId);
      token = typeof value === "string" && value.length > 0 && value.length <= 9000 ? value : null;
      expiresAt = token ? now() + CONVERSATION_MAX_AGE_MS : 0;
      conversationId = token && typeof id === "string" ? id : null;
    },
    clear() { token = null; conversationId = null; scope = null; expiresAt = 0; },
  };
}
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function apiIntent(action) { return action === "purchase" ? "supplier_bill" : action === "return" ? "customer_return" : action; }
function fieldValue(field) { return field && typeof field === "object" && "value" in field ? field.value : undefined; }
function humanIntent(intent) { return ({ estimate: "Estimate", supplier_bill: "Supplier bill", customer_return: "Customer return", inventory_adjustment: "Stock adjustment", rate_list_update: "Rate list update", invoice: "Invoice" })[intent] ?? "ERP action"; }

export function conversationDraftMarkup(draft) {
  return `<article class="review-card" data-conversation-draft><div class="review-heading"><h3>Estimate in progress</h3><span class="status-pill review">${draft.prepared ? "Review required" : "Conversation draft"}</span></div>
    <p>Customer: ${escapeHtml(draft.customer?.name ?? "Please identify the customer")}</p>
    <div class="review-lines">${(draft.lines ?? []).map(line => `<div class="review-line"><strong>${escapeHtml(line.productName)}</strong><p>${escapeHtml(line.quantity)} ${escapeHtml(line.unit)} · ${escapeHtml(line.discountPercent)}% discount</p><p>${line.rate ? escapeHtml(line.rate.currency_code) + " " + escapeHtml(line.rate.unit_price) + " / " + escapeHtml(line.rate.unit) : "Current rate unavailable"}</p><p>${line.amount == null ? escapeHtml(line.error ?? "Needs verification") : escapeHtml(draft.currencyCode) + " " + escapeHtml(line.amount.toFixed(2))}</p></div>`).join("")}</div>
    <p><strong>${draft.totals ? "Total: " + escapeHtml(draft.currencyCode) + " " + escapeHtml(draft.totals.grand_total.toFixed(2)) : "Total unavailable until all rates are verified."}</strong></p>
    <p>Continue this conversation to add, remove or correct items. Nothing is executed without your explicit confirmation.</p>
    ${draft.prepared && draft.totals ? '<button class="button primary" type="button" data-prepare-conversation-draft>Prepare draft</button>' : ""}</article>`;
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
  if (file.size > MAX_MEDIA_BYTES) throw new Error("Attachments must be 8 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  return { mimeType: file.type || "application/octet-stream", base64: btoa(binary) };
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
  let attachmentFromCamera = false;
  let attachmentUrl = null;
  let review = null;
  let activeDraft = null;
  let preparedConversation = null;
  let operationBusy = false;
  let recorder = null;
  let recordingStream = null;
  let recordingChunks = [];
  let retryAction = null;
  const conversation = createCopilotConversation();
  const quoteVersions = new Map();

  document.querySelector("#copilot-close").innerHTML = icon("close");
  document.querySelector("#copilot-attach").innerHTML = icon("paperclip");
  document.querySelector("#copilot-camera-button").innerHTML = icon("camera");
  micButton.innerHTML = icon("mic");
  sendButton.innerHTML = icon("send");

  function scrollThread() { requestAnimationFrame(() => thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" })); }
  function appendMessage(role, body, className = "") {
    const message = document.createElement("div");
    message.className = `chat-message ${role} ${className}`.trim();
    message.innerHTML = role === "assistant" ? `<span class="assistant-mark">${icon("sparkles")}</span><div class="message-body">${body}</div>` : `<div class="message-body">${body}</div>`;
    thread.append(message); scrollThread(); return message;
  }
  function welcome() {
    thread.innerHTML = "";
    appendMessage("assistant", `<p><strong>Ask about your ERP data or prepare an action.</strong></p><p>I can look up products and current Rate List prices, or prepare an estimate, supplier bill, or return for your review. Select a task to prepare an action or analyze an image, PDF, or voice note.</p><div class="prompt-chips"><button type="button" data-prompt="What is the current rate of 25mm PPRC pipe?">Check a rate</button><button type="button" data-task="estimate" data-prompt="Prepare an estimate for 50 pieces of 25mm Popular pipe">New estimate</button><button type="button" data-task="purchase" data-prompt="Review this supplier bill">Supplier bill</button></div>`);
  }
  function setBusy(busy, message = "") {
    operationBusy = busy;
    sendButton.disabled = busy; task.disabled = busy; input.disabled = busy;
    status.hidden = !busy; status.innerHTML = busy ? `<span class="spinner"></span>${escapeHtml(message)}` : "";
  }
  function clearAttachment() {
    if (attachmentUrl) URL.revokeObjectURL(attachmentUrl);
    attachmentUrl = null; attachment = null; attachmentFromCamera = false; fileInput.value = ""; cameraInput.value = ""; attachmentRoot.hidden = true; attachmentRoot.innerHTML = "";
  }
  function showAttachment(file, fromCamera = false) {
    clearAttachment();
    if (file.size > MAX_MEDIA_BYTES) { showError(new Error("Attachments must be 8 MB or smaller.")); return; }
    attachment = file; attachmentFromCamera = fromCamera;
    const imagePreview = file.type.startsWith("image/") ? `<img src="${(attachmentUrl = URL.createObjectURL(file))}" alt="Attachment preview" />` : `<span class="attachment-icon">${icon(file.type.startsWith("audio/") ? "mic" : "file")}</span>`;
    attachmentRoot.innerHTML = `${imagePreview}<span><strong>${escapeHtml(file.name || "Voice recording")}</strong><small>${escapeHtml(attachmentLabel(file))}</small></span><button class="icon-button" type="button" data-remove-attachment aria-label="Remove attachment">${icon("close")}</button>`;
    attachmentRoot.hidden = false;
  }
  function showError(error, action = null) {
    const message = error instanceof Error ? error.message : "Copilot could not complete that request.";
    retryAction = action;
    appendMessage("assistant", `<div class="message-error">${icon("alert")}<span><strong>Request not completed</strong><p>${escapeHtml(message)}</p>${action ? '<button class="button secondary compact" type="button" data-copilot-retry>Try again</button>' : ""}</span></div>`, "error");
  }
  function contextOrThrow() {
    if (!getAuthenticatedUserId()) throw new Error("Sign in before asking Copilot to access ERP data.");
    const context = getWorkspaceContext();
    if (!context) throw new Error("Choose your workspace before using Copilot.");
    return context;
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

  async function analyze() {
    if (operationBusy) return;
    const context = contextOrThrow();
    const text = input.value.trim();
    if (!text && !attachment) throw new Error("Write a message or add an attachment first.");
    const action = task.value;
    const source = sourceForAttachment(attachment, attachmentFromCamera);
    if (action === "auto" && source !== "text") throw new Error("Choose the ERP task for voice, image, camera, or PDF input.");
    const display = text || (source === "voice" ? "Voice note" : fromCameraLabel(source));
    appendMessage("user", `<p>${escapeHtml(display)}</p>${attachment ? `<small>${escapeHtml(attachmentLabel(attachment))}</small>` : ""}`);
    const sentAttachment = attachment;
    input.value = ""; input.style.height = "auto"; clearAttachment();
    setBusy(true, source === "voice" ? "Transcribing and reviewing" : "Reviewing your request");
    const payload = { organizationId: context.organizationId, userId: getAuthenticatedUserId(), source, ...(text ? { text } : {}), ...(sentAttachment ? { media: await readFileAsBase64(sentAttachment) } : {}) };
    try {
      if ((action === "auto" || action === "estimate") && source === "text") {
        const userId = getAuthenticatedUserId();
        const token = conversation.tokenFor(userId, context.organizationId, context.branchId);
        const conversationId = conversation.idFor(userId, context.organizationId, context.branchId);
        activeDraft = null; preparedConversation = null;
        thread.querySelectorAll("[data-conversation-draft], [data-conversation-payment], .confirmation-card").forEach(card => card.remove());
        const response = await askCopilot(text, context.organizationId, context.branchId, token, conversationId);
        if (typeof response.data?.answer !== "string") throw new Error("Copilot did not return an answer.");
        conversation.accept(response.data.conversationToken, userId, context.organizationId, context.branchId, response.data.conversationId);
        activeDraft = null; preparedConversation = null;
        appendMessage("assistant", `<p>${escapeHtml(response.data.answer).split("\n\n").join("</p><p>")}</p>`);
        if (response.data.draft) {
          appendMessage("assistant", conversationDraftMarkup(response.data.draft));
          if (response.data.draft.prepared) preparedConversation = { token: response.data.conversationToken, conversationId: response.data.conversationId };
        }
        if (response.data.paymentPreparation) {
          appendMessage("assistant", conversationPaymentMarkup(response.data.paymentPreparation));
          preparedConversation = { token: response.data.conversationToken, conversationId: response.data.conversationId, kind: "payment" };
        }
        return;
      }
      if (action === "invoice_extract") {
        const response = await extractInvoiceDocument(payload, context.branchId);
        const extraction = response.data;
        appendMessage("assistant", `<article class="review-card"><div class="review-heading"><div><span class="status-pill neutral">Extraction only</span><h3>Invoice review</h3></div></div><p>${extraction.lines?.length ?? 0} line(s) extracted. This does not create or post an invoice.</p><div class="review-lines">${(extraction.lines ?? []).map((line, index) => `<div class="review-line"><div class="review-line-title"><span>${index + 1}</span><strong>${escapeHtml(line.productName?.value ?? line.productName ?? "Unrecognized item")}</strong></div></div>`).join("")}</div><div class="review-actions"><button class="button secondary" type="button" data-review-cancel>Close review</button></div></article>`);
        return;
      }
      payload.intent = action === "auto" ? "auto" : apiIntent(action);
      const response = await createCopilotReview(payload, context.branchId);
      thread.querySelector("[data-review-card]")?.remove();
      review = response.data;
      quoteVersions.clear();
      appendMessage("assistant", reviewCardMarkup(review));
    } finally { setBusy(false); }
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

  async function confirmDraft() {
    if (operationBusy) return;
    if (!activeDraft) throw new Error("No draft is waiting for confirmation.");
    const context = getWorkspaceContext();
    if (context.organizationId !== activeDraft.organizationId || context.branchId !== activeDraft.branchId) throw new Error("Return to the draft's workspace and branch before confirming.");
    if (!navigator.onLine) throw new Error("Go online before confirming an ERP action.");
    setBusy(true, "Confirming with the authoritative ERP service");
    try {
      const response = await confirmCopilotDraft({ ...activeDraft, userId: getAuthenticatedUserId() });
      const completed = activeDraft;
      activeDraft = null;
      conversation.clear(); preparedConversation = null;
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
    setBusy(true, payment ? "Preparing the reviewed payment" : "Preparing the reviewed estimate");
    try {
      const prepare = payment ? prepareConversationPayment : prepareConversationDraft;
      const response = await prepare(preparedConversation.token, preparedConversation.conversationId, context.organizationId, context.branchId);
      activeDraft = { id: response.data.id, organizationId: context.organizationId, branchId: context.branchId, idempotencyKey: response.data.idempotencyKey, intent: payment ? response.paymentPreparation.intent : "estimate" };
      thread.querySelectorAll("[data-conversation-draft], [data-conversation-payment]").forEach(card => card.remove());
      appendMessage("assistant", payment ? conversationPaymentMarkup(response.paymentPreparation, true) : conversationDraftMarkup(response.draft));
      preparedConversation = null;
      thread.querySelectorAll(".confirmation-card").forEach(card => card.remove());
      appendMessage("assistant", `<article class="confirmation-card"><h3>${payment ? "Payment" : "Estimate"} ready for confirmation</h3><p>${payment ? "Review the party, payment direction, amount, date, method and allocations above." : "Review the customer, items, rates, discount and total above."} Confirm action to execute through the ERP service.</p><div class="review-actions"><button class="button secondary" type="button" data-draft-cancel>Cancel</button><button class="button danger" type="button" data-confirm-draft>Confirm action</button></div></article>`);
    } finally { setBusy(false); }
  }

  async function toggleRecording() {
    if (recorder?.state === "recording") { recorder.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Voice recording is not supported by this browser.");
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    recorder = new MediaRecorder(recordingStream);
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size) recordingChunks.push(event.data); });
    recorder.addEventListener("stop", () => { const blob = new Blob(recordingChunks, { type: recorder.mimeType || "audio/webm" }); showAttachment(new File([blob], `voice-${Date.now()}.webm`, { type: blob.type })); recordingStream?.getTracks().forEach((track) => track.stop()); recordingStream = null; micButton.classList.remove("recording"); micButton.innerHTML = icon("mic"); micButton.setAttribute("aria-label", "Record voice"); status.hidden = true; status.textContent = ""; });
    recorder.start(); micButton.classList.add("recording"); micButton.innerHTML = icon("stop"); micButton.setAttribute("aria-label", "Stop recording"); status.hidden = false; status.textContent = "Recording voice note. Select stop when finished.";
  }

  async function run(action) { try { retryAction = null; await action(); } catch (error) { setBusy(false); showError(error, action); } }
  function reset() { if (recorder?.state === "recording") recorder.stop(); clearAttachment(); review = null; activeDraft = null; preparedConversation = null; retryAction = null; conversation.clear(); input.value = ""; task.value = "auto"; status.hidden = true; setBusy(false); welcome(); }

  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 150)}px`; });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void run(analyze); } });
  sendButton.addEventListener("click", () => void run(analyze));
  task.addEventListener("change", () => { if (!["auto", "estimate"].includes(task.value)) { conversation.clear(); preparedConversation = null; } });
  document.querySelector("#copilot-attach").addEventListener("click", () => fileInput.click());
  document.querySelector("#copilot-camera-button").addEventListener("click", () => cameraInput.click());
  micButton.addEventListener("click", () => void run(toggleRecording));
  fileInput.addEventListener("change", () => { if (fileInput.files?.[0]) showAttachment(fileInput.files[0]); });
  cameraInput.addEventListener("change", () => { if (cameraInput.files?.[0]) showAttachment(cameraInput.files[0], true); });
  attachmentRoot.addEventListener("click", (event) => { if (event.target.closest("[data-remove-attachment]")) clearAttachment(); });
  thread.addEventListener("click", (event) => {
    const prompt = event.target.closest("[data-prompt]");
    if (prompt) { if (prompt.dataset.task) { task.value = prompt.dataset.task; conversation.clear(); } input.value = prompt.dataset.prompt; input.focus(); }
    if (event.target.closest("[data-review-cancel]")) { review = null; quoteVersions.clear(); event.target.closest(".review-card")?.remove(); appendMessage("assistant", "<p>Review cancelled. No ERP data was changed.</p>"); }
    if (event.target.closest("[data-prepare-draft]")) void run(prepareDraft);
    if (event.target.closest("[data-prepare-conversation-draft]")) void run(prepareStatefulDraft);
    if (event.target.closest("[data-prepare-conversation-payment]")) void run(prepareStatefulDraft);
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
  document.querySelector("#copilot-close").addEventListener("click", () => dialog.close());
  document.querySelector("#copilot-button").addEventListener("click", () => { if (!dialog.open) dialog.showModal(); input.focus(); });
  welcome();
  return { open: () => { if (!dialog.open) dialog.showModal(); input.focus(); }, reset };
}

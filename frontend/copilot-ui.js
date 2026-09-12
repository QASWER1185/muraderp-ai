import { createCopilotDraft, createCopilotFinancialDraft, createCopilotMasterDataDraft, createCopilotRateListDraft, createCopilotReview, extractInvoiceDocument, confirmCopilotDraft } from "./copilot-api.js";
import { queueJsonRequest } from "./offline-sync.js";

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const ACTIONS = new Set(["estimate", "customer_create", "vendor_create", "purchase", "return", "inventory_adjustment", "rate_list_update", "customer_payment", "vendor_payment"]);
const MASTER_DATA_ACTIONS = new Set(["customer_create", "vendor_create"]);
const FINANCIAL_ACTIONS = new Set(["customer_payment", "vendor_payment"]);

function apiAction(action) {
  return action === "purchase" ? "supplier_bill" : action === "return" ? "customer_return" : action;
}

function value(selector) {
  return document.querySelector(selector)?.value.trim() || "";
}

function optionalPositiveInteger(selector) {
  const raw = value(selector);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${selector} must be a positive integer`);
  return parsed;
}

function optionalNumber(selector) {
  const raw = value(selector);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${selector} must be zero or greater`);
  return parsed;
}

function readFileAsBase64(file) {
  if (file.size > MAX_MEDIA_BYTES) throw new Error("Media must be 8 MB or smaller.");
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
    return { mimeType: file.type, base64: btoa(binary) };
  });
}

function fieldValue(field) {
  return field && typeof field === "object" && "value" in field ? field.value : undefined;
}

function createElement(tag, attributes = {}, text) {
  const element = document.createElement(tag);
  for (const [name, attribute] of Object.entries(attributes)) if (attribute !== undefined && attribute !== null && attribute !== "") element.setAttribute(name, String(attribute));
  if (text !== undefined) element.textContent = text;
  return element;
}

function lineFromReview(line, proposalLine) {
  return {
    productName: line.productName,
    productId: line.product.selectedId ?? fieldValue(proposalLine?.productId),
    quantity: line.quantity ?? fieldValue(proposalLine?.quantity),
    unit: line.unit ?? fieldValue(proposalLine?.unit),
    unitRate: line.explicitUnitRate ?? fieldValue(proposalLine?.unitRate),
    rateListId: line.rateList.selectedId ?? fieldValue(proposalLine?.rateListId),
    brandHint: line.brandHint || "",
    sourceItemId: "",
    productCandidates: line.product.candidates,
    rateCandidates: line.rateList.candidates,
    warnings: line.warnings,
  };
}

export function mountCopilot({ getAuthenticatedUserId, openNativeAction }) {
  const dialog = document.querySelector("#copilot");
  const result = document.querySelector("#copilot-result");
  const linesRoot = document.querySelector("#copilot-lines");
  const runButton = document.querySelector("#copilot-run");
  const confirmButton = document.querySelector("#copilot-confirm");
  const openEstimateButton = document.querySelector("#copilot-open-estimate");
  const fileInput = document.querySelector("#copilot-file");
  let review = null;
  let activeDraft = null;

  function updateActionFields() {
    const action = value("#copilot-action");
    const masterData = MASTER_DATA_ACTIONS.has(action);
    const financial = FINANCIAL_ACTIONS.has(action);
    document.querySelector("#copilot-master-data").hidden = !masterData;
    document.querySelector("#copilot-rate-list-update").hidden = action !== "rate_list_update";
    document.querySelector("#copilot-financial").hidden = !financial;
    document.querySelector("#copilot-lines").hidden = masterData || financial;
    document.querySelector("#copilot-add-line").hidden = masterData || financial;
    const method = document.querySelector("#copilot-payment-method");
    if (financial) {
      const methods = action === "vendor_payment" ? ["CASH", "BANK", "OTHER"] : ["CASH", "BANK_TRANSFER", "CARD", "CHEQUE", "OTHER"];
      method.replaceChildren(...methods.map((item) => createElement("option", { value: item }, item.replaceAll("_", " "))));
    }
  }

  function financialProposal(action) {
    const amount = optionalNumber("#copilot-payment-amount");
    const paymentDate = value("#copilot-payment-date");
    if (!amount || !paymentDate) throw new Error("Payment amount and date are required.");
    const rawAllocations = value("#copilot-payment-allocations").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
    if (!rawAllocations.length) throw new Error("Add at least one payment allocation as ID:amount.");
    const allocations = rawAllocations.map((entry, index) => {
      const [rawId, rawAmount, ...extra] = entry.split(":").map((item) => item.trim());
      const id = Number(rawId); const allocationAmount = Number(rawAmount);
      if (extra.length || !Number.isInteger(id) || id <= 0 || !Number.isFinite(allocationAmount) || allocationAmount <= 0) throw new Error(`Allocation ${index + 1} must use ID:amount.`);
      return action === "customer_payment" ? { invoiceId: id, amount: allocationAmount } : { purchaseId: id, amount: allocationAmount };
    });
    if (Math.abs(allocations.reduce((sum, item) => sum + item.amount, 0) - amount) > 0.000001) throw new Error("Allocated amount must equal the payment amount.");
    const partyId = optionalPositiveInteger(action === "customer_payment" ? "#copilot-customer" : "#copilot-vendor");
    if (!partyId) throw new Error(action === "customer_payment" ? "Customer ID is required." : "Vendor ID is required.");
    return {
      amount, paymentDate, paymentMethod: value("#copilot-payment-method"), allocations,
      ...(action === "customer_payment" ? { customerId: partyId, currencyCode: value("#copilot-currency").toUpperCase() || "PKR" } : { vendorId: partyId }),
      ...(value("#copilot-payment-reference") ? { reference: value("#copilot-payment-reference") } : {}),
      ...(value("#copilot-reason") ? { notes: value("#copilot-reason") } : {}),
    };
  }

  function show(message) {
    result.hidden = false;
    result.textContent = message;
  }

  function resetLines(lines = [{ productName: "", productId: "", quantity: "1", unit: "pcs", unitRate: "", rateListId: "", brandHint: "", sourceItemId: "", productCandidates: [], rateCandidates: [], warnings: [] }]) {
    linesRoot.replaceChildren();
    lines.forEach((line, index) => {
      const card = createElement("div", { class: "line-review" });
      const heading = createElement("div", { class: "line-review-heading" });
      heading.append(createElement("strong", {}, `Line ${index + 1}`));
      const remove = createElement("button", { class: "button secondary compact", type: "button" }, "Remove");
      remove.addEventListener("click", () => { card.remove(); renumberLines(); });
      heading.append(remove); card.append(heading);
      const grid = createElement("div", { class: "line-review-grid" });
      const productListId = `copilot-products-${index}`;
      const rateListId = `copilot-rates-${index}`;
      const fields = [
        ["Product description", "product-name", line.productName ?? "", "text", ""],
        ["Product ID", "product-id", line.productId ?? "", "number", productListId],
        ["Quantity", "quantity", line.quantity ?? "", "number", ""],
        ["Unit", "unit", line.unit ?? "", "text", ""],
        ["Explicit rate", "unit-rate", line.unitRate ?? "", "number", ""],
        ["Rate List ID", "rate-list-id", line.rateListId ?? "", "number", rateListId],
        ["Brand / company hint", "brand-hint", line.brandHint ?? "", "text", ""],
      ];
      if (value("#copilot-action") === "return") fields.push(["Source invoice item ID", "source-item-id", line.sourceItemId ?? "", "number", ""]);
      for (const [label, name, initial, type, list] of fields) {
        const wrapper = createElement("label", { class: "line-field" });
        wrapper.append(createElement("span", {}, label));
        const input = createElement("input", { class: `line-${name}`, type, value: String(initial ?? ""), min: type === "number" ? "0" : undefined, step: type === "number" ? "any" : undefined, list: list || undefined });
        if (name === "product-name") input.required = true;
        wrapper.append(input);
        if (list) {
          const datalist = createElement("datalist", { id: list });
          const candidates = list.startsWith("copilot-products") ? line.productCandidates : line.rateCandidates;
          for (const candidate of candidates ?? []) datalist.append(createElement("option", { value: String(candidate.id) }, `${candidate.label} (${Math.round(candidate.confidence * 100)}%)`));
          wrapper.append(datalist);
        }
        grid.append(wrapper);
      }
      const warnings = createElement("p", { class: "line-warning" }, (line.warnings ?? []).join(" "));
      if (!(line.warnings ?? []).length) warnings.hidden = true;
      card.append(grid, warnings); linesRoot.append(card);
    });
  }

  function renumberLines() {
    linesRoot.querySelectorAll(".line-review-heading strong").forEach((heading, index) => { heading.textContent = `Line ${index + 1}`; });
  }

  function collectLines() {
    const cards = [...linesRoot.querySelectorAll(".line-review")];
    if (!cards.length) throw new Error("Add at least one transaction line.");
    return cards.map((card, index) => {
      const read = (name) => card.querySelector(`.line-${name}`)?.value.trim() || "";
      const productName = read("product-name");
      const quantity = Number(read("quantity"));
      if (!productName) throw new Error(`Line ${index + 1} product description is required.`);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Line ${index + 1} quantity must be greater than zero.`);
      const productId = read("product-id");
      if (!productId || !Number.isInteger(Number(productId)) || Number(productId) <= 0) throw new Error(`Line ${index + 1} needs a valid Product ID before creating the draft.`);
      const line = { productName, productId, quantity, ...(read("unit") ? { unit: read("unit") } : {}) };
      const unitRate = read("unit-rate"); const rateListId = read("rate-list-id"); const brandHint = read("brand-hint"); const sourceItemId = read("source-item-id");
      if (unitRate) { const parsed = Number(unitRate); if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Line ${index + 1} explicit rate is invalid.`); line.unitRate = parsed; }
      if (rateListId) { if (!Number.isInteger(Number(rateListId)) || Number(rateListId) <= 0) throw new Error(`Line ${index + 1} Rate List ID is invalid.`); line.rateListId = Number(rateListId); }
      if (brandHint) line.brandHint = brandHint;
      if (sourceItemId) { if (!Number.isInteger(Number(sourceItemId)) || Number(sourceItemId) <= 0) throw new Error(`Line ${index + 1} source item ID is invalid.`); line.sourceItemId = Number(sourceItemId); }
      return line;
    });
  }

  async function prepare() {
    const userId = getAuthenticatedUserId();
    if (!userId) throw new Error("Sign in before using AI Copilot.");
    const organizationId = value("#copilot-organization"); const branchId = value("#copilot-branch");
    if (!organizationId) throw new Error("Organization ID is required.");
    if (!branchId) throw new Error("Branch ID is required.");
    const source = value("#copilot-input-type"); const action = value("#copilot-action");
    const text = value("#copilot-input");
    if (MASTER_DATA_ACTIONS.has(action)) {
      const masterData = { name: value("#copilot-party-name"), phone: value("#copilot-party-phone"), city: value("#copilot-party-city") };
      if (!masterData.name || !masterData.phone || !masterData.city) throw new Error("Name, phone, and city are required before reviewing this master-data proposal.");
      review = { intent: action, confidence: 1, masterData, requiresConfirmation: true };
      show(`REVIEW READY\n\n${action === "customer_create" ? "Customer" : "Vendor"}: ${masterData.name}\nPhone: ${masterData.phone}\nCity: ${masterData.city}\n\nReview these details before creating the draft.`);
      runButton.textContent = "Create draft";
      return;
    }
    if (FINANCIAL_ACTIONS.has(action)) {
      const paymentData = financialProposal(action);
      review = { intent: action, confidence: 1, paymentData, requiresConfirmation: true };
      show(`REVIEW READY\n\n${action === "customer_payment" ? "Customer" : "Vendor"} payment: ${paymentData.amount}\nAllocations: ${paymentData.allocations.length}\n\nReview these financial details before creating the draft.`);
      runButton.textContent = "Create draft";
      return;
    }
    const payload = { organizationId, userId, source, intent: action === "auto" ? "auto" : apiAction(action), ...(text ? { text } : {}) };
    const customerId = optionalPositiveInteger("#copilot-customer"); const vendorId = optionalPositiveInteger("#copilot-vendor"); const warehouseId = optionalPositiveInteger("#copilot-warehouse"); const rateListId = optionalPositiveInteger("#copilot-rate-list");
    if (customerId !== undefined) payload.customerId = customerId; if (vendorId !== undefined) payload.vendorId = vendorId; if (warehouseId !== undefined) payload.warehouseId = warehouseId; if (rateListId !== undefined) payload.rateListId = rateListId;
    const file = fileInput.files?.[0]; if (file) payload.media = await readFileAsBase64(file);
    if (source === "text" && !text) throw new Error("Describe the business action or material list.");
    if (action === "invoice_extract") {
      delete payload.intent;
      const response = await extractInvoiceDocument(payload, branchId);
      const extraction = response.data;
      const proposalLines = extraction.proposal?.lines ?? [];
      resetLines(extraction.lines.map((line, index) => lineFromReview(line, proposalLines[index])));
      show(`INVOICE EXTRACTED — REVIEW ONLY\n\n${extraction.lines.length} line(s) extracted. Values remain editable for review, but Copilot will not create or execute an Invoice. Use the Estimate and native conversion workflow for posting.`);
      review = null; runButton.hidden = true; confirmButton.hidden = true;
      return;
    }
    const response = await createCopilotReview(payload, branchId);
    review = response.data;
    const proposalLines = review.proposal?.lines ?? [];
    resetLines(review.lines.map((line, index) => lineFromReview(line, proposalLines[index])));
    if (review.customer.selectedId) document.querySelector("#copilot-customer").value = String(review.customer.selectedId);
    if (review.vendor.selectedId) document.querySelector("#copilot-vendor").value = String(review.vendor.selectedId);
    if (review.warehouse.selectedId) document.querySelector("#copilot-warehouse").value = String(review.warehouse.selectedId);
    if (fieldValue(review.proposal?.documentNumber)) document.querySelector("#copilot-document").value = fieldValue(review.proposal.documentNumber);
    if (fieldValue(review.proposal?.documentDate)) document.querySelector("#copilot-document-date").value = fieldValue(review.proposal.documentDate);
    if (fieldValue(review.proposal?.currencyCode)) document.querySelector("#copilot-currency").value = fieldValue(review.proposal.currencyCode);
    const warningText = review.warnings?.length ? `\n\nWarnings:\n${review.warnings.join("\n")}` : "";
    show(`REVIEW READY\n\n${review.intent} · ${Math.round(review.confidence * 100)}% extraction confidence\n${review.blockingReasons?.length ? `Resolve ${review.blockingReasons.length} review item(s) before creating the draft.` : "Review the extracted lines before creating the draft."}${warningText}`);
    runButton.textContent = "Create draft";
    document.querySelector("#copilot-add-line").hidden = false;
  }

  async function createDraft() {
    const userId = getAuthenticatedUserId(); if (!userId) throw new Error("Sign in before using AI Copilot.");
    const organizationId = value("#copilot-organization"); const branchId = value("#copilot-branch"); const action = review?.intent ?? apiAction(value("#copilot-action"));
    if (!ACTIONS.has(value("#copilot-action")) && !review) throw new Error("Choose a supported Copilot action.");
    const masterDataAction = MASTER_DATA_ACTIONS.has(action);
    const financialAction = FINANCIAL_ACTIONS.has(action);
    const rateListAction = action === "rate_list_update";
    const lines = masterDataAction || financialAction ? [] : collectLines();
    let payload = masterDataAction
      ? { organizationId, userId, intent: action, source: value("#copilot-input-type"), ...review.masterData }
      : financialAction
        ? { organizationId, userId, intent: action, source: value("#copilot-input-type"), ...review.paymentData }
      : { organizationId, userId, intent: action, source: value("#copilot-input-type"), customerId: value("#copilot-customer") || undefined, vendorId: value("#copilot-vendor") || undefined, warehouseId: optionalPositiveInteger("#copilot-warehouse"), rateListId: optionalPositiveInteger("#copilot-rate-list"), documentNumber: value("#copilot-document") || undefined, documentDate: value("#copilot-document-date") || undefined, currencyCode: value("#copilot-currency").toUpperCase() || undefined, reason: value("#copilot-reason") || undefined, lines, confidence: review?.confidence ?? 1 };
    if (rateListAction) {
      const rateListId = optionalPositiveInteger("#copilot-rate-list");
      const versionNumber = optionalPositiveInteger("#copilot-rate-list-version");
      const effectiveDate = value("#copilot-rate-list-effective");
      if (!rateListId || !versionNumber || !effectiveDate) throw new Error("Rate List ID, new version number, and effective date are required.");
      payload = {
        organizationId, userId, source: value("#copilot-input-type"), rateListId, versionNumber,
        effectiveFrom: `${effectiveDate}T00:00:00.000Z`,
        lines: lines.map((line, index) => {
          if (!line.unit?.trim()) throw new Error(`Line ${index + 1} unit is required.`);
          if (line.unitRate === undefined) throw new Error(`Line ${index + 1} rate is required.`);
          return { productName: line.productName, productId: Number(line.productId), minimumQuantity: line.quantity, unit: line.unit, unitRate: line.unitRate };
        }),
      };
    }
    const idempotencyKey = `copilot-draft-${crypto.randomUUID()}`;
    const endpoint = masterDataAction ? "/api/v1/ai/copilot/master-data/drafts" : financialAction ? "/api/v1/ai/copilot/financial/drafts" : rateListAction ? "/api/v1/ai/copilot/rate-list/drafts" : "/api/v1/ai/copilot/drafts";
    if (!navigator.onLine) {
      await queueJsonRequest({ endpoint, method: "POST", headers: { "X-Branch-Id": branchId, "Idempotency-Key": idempotencyKey }, body: payload, kind: "copilot-draft" });
      show("OFFLINE DRAFT QUEUED\n\nThe reviewed draft is stored on this device and will be sent when the connection returns. Final execution still requires online confirmation.");
      runButton.hidden = true; return;
    }
    const response = masterDataAction
      ? await createCopilotMasterDataDraft(payload, branchId, idempotencyKey)
      : financialAction
        ? await createCopilotFinancialDraft(payload, branchId, idempotencyKey)
      : rateListAction
        ? await createCopilotRateListDraft(payload, branchId, idempotencyKey)
        : await createCopilotDraft(payload, branchId, idempotencyKey);
    activeDraft = { id: response.data.id, organizationId, branchId, idempotencyKey, intent: action };
    if (action === "inventory_adjustment") {
      show(`PROPOSAL SAVED\n\n${JSON.stringify(response.data, null, 2)}\n\nAuthoritative inventory execution is unavailable until the costed accounting-safe transaction service is present.`);
      activeDraft = null; runButton.hidden = true; confirmButton.hidden = true; return;
    }
    show(`DRAFT CREATED\n\n${JSON.stringify(response.data, null, 2)}\n\nReview complete. Explicit confirmation is required before execution.`);
    runButton.hidden = true; confirmButton.hidden = false;
  }

  async function confirm() {
    if (!activeDraft || !getAuthenticatedUserId()) throw new Error("No authenticated Copilot draft is ready for confirmation.");
    if (!navigator.onLine) throw new Error("Confirmation requires an online connection so the authoritative ERP service can validate and execute the transaction.");
    const response = await confirmCopilotDraft({ ...activeDraft, userId: getAuthenticatedUserId() });
    show(`${response.executed ? "EXECUTED" : "NOT EXECUTED"}\n\n${JSON.stringify(response.data, null, 2)}`);
    const resultData = response.data?.result;
    const nativeId = activeDraft.intent === "rate_list_update" ? resultData?.version?.id
      : activeDraft.intent === "customer_payment" ? resultData?.payment?.id
        : activeDraft.intent === "supplier_bill" ? resultData?.purchase?.id
          : activeDraft.intent === "customer_return" ? resultData?.credit_note?.id
            : typeof resultData === "object" ? resultData?.id : resultData;
    confirmButton.hidden = true;
    if (nativeId != null) {
      openEstimateButton.dataset.recordId = String(nativeId);
      openEstimateButton.dataset.intent = activeDraft.intent;
      openEstimateButton.textContent = "Open in ERP";
      openEstimateButton.hidden = false;
    }
    activeDraft = null;
  }

  function reset() {
    review = null; activeDraft = null; runButton.hidden = false; runButton.textContent = "Analyze input"; confirmButton.hidden = true; openEstimateButton.hidden = true; openEstimateButton.textContent = "Open in ERP"; delete openEstimateButton.dataset.recordId; delete openEstimateButton.dataset.intent; document.querySelector("#copilot-add-line").hidden = false; resetLines(); updateActionFields(); if (result) result.hidden = true;
  }

  document.querySelector("#copilot-add-line").addEventListener("click", () => { resetLines([...collectRawLines(), { productName: "", productId: "", quantity: "1", unit: "pcs", unitRate: "", rateListId: "", brandHint: "", sourceItemId: "", productCandidates: [], rateCandidates: [], warnings: [] }]); });
  function collectRawLines() { return [...linesRoot.querySelectorAll(".line-review")].map((card) => ({ productName: card.querySelector(".line-product-name")?.value || "", productId: card.querySelector(".line-product-id")?.value || "", quantity: card.querySelector(".line-quantity")?.value || "", unit: card.querySelector(".line-unit")?.value || "", unitRate: card.querySelector(".line-unit-rate")?.value || "", rateListId: card.querySelector(".line-rate-list-id")?.value || "", brandHint: card.querySelector(".line-brand-hint")?.value || "", sourceItemId: card.querySelector(".line-source-item-id")?.value || "", productCandidates: [], rateCandidates: [], warnings: [] })); }
  runButton.addEventListener("click", async () => { try { if (review) await createDraft(); else await prepare(); } catch (error) { show(error instanceof Error ? error.message : "Unable to prepare the Copilot review."); } });
  confirmButton.addEventListener("click", async () => { try { await confirm(); } catch (error) { show(error instanceof Error ? error.message : "Unable to confirm Copilot action."); } });
  openEstimateButton.addEventListener("click", () => {
    const recordId = openEstimateButton.dataset.recordId;
    const intent = openEstimateButton.dataset.intent;
    if (recordId && intent && openNativeAction) openNativeAction(intent, recordId);
    dialog.close();
  });
  document.querySelector("#copilot-action").addEventListener("change", () => { review = null; runButton.hidden = false; runButton.textContent = "Analyze input"; resetLines(); updateActionFields(); });
  document.querySelector("#copilot-input-type").addEventListener("change", () => { const source = value("#copilot-input-type"); fileInput.hidden = source === "text"; fileInput.accept = source === "voice" ? "audio/*" : source === "camera" ? "image/*" : "image/*,.pdf,application/pdf"; fileInput.setAttribute("capture", source === "camera" ? "environment" : source === "voice" ? "user" : ""); });
  document.querySelector("#copilot-button").addEventListener("click", () => { reset(); dialog.showModal(); });
  document.querySelector("#copilot-close").addEventListener("click", () => dialog.close());
  reset();
  return { open: () => { reset(); dialog.showModal(); }, reset };
}

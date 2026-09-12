async function postConversion(context, action, payload, key) {
  const response = await fetch(`/api/v1/estimates/${encodeURIComponent(context.sourceId)}/reprice/${action}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", "X-Organization-Id": context.organizationId, "X-Branch-Id": context.branchId, ...(key ? { "Idempotency-Key": key } : {}) },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Estimate conversion failed");
  return body.data;
}

export async function prepareEstimateWhatsAppShare(context) {
  const response = await fetch(`/api/v1/estimates/${encodeURIComponent(context.estimateId)}/whatsapp-share`, {
    method: "GET", credentials: "include",
    headers: { "X-Organization-Id": context.organizationId, "X-Branch-Id": context.branchId },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? "WhatsApp share could not be prepared");
  const shareUrl = new URL(body.data?.share_url);
  if (shareUrl.protocol !== "https:" || shareUrl.hostname !== "wa.me") throw new Error("WhatsApp share returned an invalid destination");
  return body.data;
}

// Keep the reviewed payload and retry key together; form changes discard both.
export function createConversionSession() {
  let reviewed = null;
  return {
    clear() { reviewed = null; },
    async preview(context, payload) {
      reviewed = null;
      const result = await postConversion(context, "preview", payload);
      if (result.can_create) reviewed = { context: { ...context }, payload: { ...payload }, fingerprint: result.preview_fingerprint, key: `estimate-clone-${crypto.randomUUID()}`, number: null };
      return result;
    },
    async confirm(number) {
      if (!reviewed) throw new Error("Review a fully resolved preview before confirming.");
      if (reviewed.number && reviewed.number !== number) throw new Error("The estimate number changed. Review a new preview before confirming.");
      reviewed.number = number;
      const result = await postConversion(reviewed.context, "confirm", { ...reviewed.payload, target_estimate_number: number, preview_fingerprint: reviewed.fingerprint }, reviewed.key);
      reviewed = null;
      return result;
    },
  };
}

export function mountEstimateConversion(container) {
  container.innerHTML = `<section class="card"><h2>Change rate list / Reprice estimate</h2><p>Open a source estimate by reference, review every price, then create a new estimate.</p>
    <form id="conversion-form" class="conversion-form">
      <label>Organization ID<input name="organization" required autocomplete="off" /></label>
      <label>Branch ID<input name="branch" required autocomplete="off" /></label>
      <label>Source Estimate ID<input name="source" type="number" min="1" step="1" required /></label>
      <label>Conversion policy<select name="mode"><option value="PRESERVE_LINE_BRAND_CONTEXT">Keep each line's company / rate list</option><option value="REPRICE_ALL_TO_TARGET_RATE_LIST">Reprice every line from one target rate list</option></select></label>
      <label id="conversion-target-label" hidden>Target Rate List ID<input name="target" type="number" min="1" step="1" /></label>
      <label>Pricing date<input name="date" type="date" required /></label>
      <label>New estimate reference<input name="number" required maxlength="100" autocomplete="off" /></label>
      <div class="dialog-actions"><button class="button secondary" type="submit">Preview prices</button><button id="conversion-confirm" class="button primary" type="button" disabled>Confirm and create new estimate</button></div>
    </form><p id="conversion-message" role="status" aria-live="polite"></p><div id="conversion-preview" class="table-wrap"></div></section>
    <section class="card"><h2>Share Estimate on WhatsApp</h2><p>Uses the Estimate customer's saved phone number and prepares the message. You complete the final Send in WhatsApp.</p>
      <form id="whatsapp-share-form" class="conversion-form">
        <label>Organization ID<input name="organization" required autocomplete="off" /></label>
        <label>Branch ID<input name="branch" required autocomplete="off" /></label>
        <label>Estimate ID<input name="estimate" type="number" min="1" step="1" required /></label>
        <div class="dialog-actions"><button class="button primary" type="submit">WhatsApp</button></div>
      </form><p id="whatsapp-share-message" role="status" aria-live="polite"></p>
    </section>`;
  const form = container.querySelector("#conversion-form");
  const confirm = container.querySelector("#conversion-confirm");
  const message = container.querySelector("#conversion-message");
  const preview = container.querySelector("#conversion-preview");
  const session = createConversionSession();
  const field = (name) => form.elements.namedItem(name);
  field("date").value = new Date().toLocaleDateString("en-CA");
  const busy = (value) => { for (const element of form.elements) element.disabled = value; if (!value) confirm.disabled = true; };
  form.addEventListener("input", () => { session.clear(); confirm.disabled = true; preview.replaceChildren(); message.textContent = ""; });
  field("mode").addEventListener("change", () => { const all = field("mode").value === "REPRICE_ALL_TO_TARGET_RATE_LIST"; container.querySelector("#conversion-target-label").hidden = !all; field("target").required = all; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const context = { sourceId: field("source").value, organizationId: field("organization").value.trim(), branchId: field("branch").value.trim() };
    const payload = { mode: field("mode").value, pricing_date: field("date").value, ...(field("mode").value === "REPRICE_ALL_TO_TARGET_RATE_LIST" ? { target_rate_list_id: Number(field("target").value) } : {}) };
    busy(true); message.textContent = "Resolving every line…";
    try {
      const result = await session.preview(context, payload);
      preview.replaceChildren();
      const table = document.createElement("table"); table.className = "table";
      const heading = table.createTHead().insertRow();
      for (const label of ["Line / Product", "Quantity", "Unit", "Original list / brand", "Original price", "Target list / brand", "Target price", "Difference", "Resolution", "Status"]) { const th = document.createElement("th"); th.textContent = label; heading.append(th); }
      const rows = table.createTBody();
      for (const line of result.lines) {
        const row = rows.insertRow();
        if (line.status !== "RESOLVED") row.className = "conversion-failure";
        for (const value of [`${line.line_number} / ${line.product_id}`, line.quantity, line.unit, `${line.original_rate_list_id ?? "—"} / ${line.original_brand_hint ?? "—"}`, line.original_price, `${line.target_rate_list_id ?? "—"} / ${line.target_brand_hint ?? "—"}`, line.target_price ?? "—", line.difference ?? "—", line.resolution_source, `${line.status}${line.message ? `: ${line.message}` : ""}`]) row.insertCell().textContent = String(value);
      }
      preview.append(table); message.textContent = result.can_create ? "Review the prices above. Confirmation creates a new estimate." : "Resolve the marked lines before creating the estimate.";
      busy(false); confirm.disabled = !result.can_create;
    } catch (error) { busy(false); message.textContent = error.message; }
  });
  confirm.addEventListener("click", async () => {
    const number = field("number").value.trim(); if (!number) { field("number").reportValidity(); return; }
    busy(true); message.textContent = "Creating the new estimate…";
    try { const result = await session.confirm(number); busy(false); message.textContent = `Created ${result.definition.estimate_number} (Estimate ID ${result.id}). Source estimate is unchanged.`; }
    catch (error) { busy(false); confirm.disabled = false; message.textContent = `${error.message} You may retry the same confirmation after a connection failure, or generate a new preview.`; }
  });

  const whatsappForm = container.querySelector("#whatsapp-share-form");
  const whatsappMessage = container.querySelector("#whatsapp-share-message");
  whatsappForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const whatsappField = (name) => whatsappForm.elements.namedItem(name);
    const button = whatsappForm.querySelector("button");
    button.disabled = true; whatsappMessage.textContent = "Preparing WhatsApp messageâ€¦";
    try {
      const delivery = await prepareEstimateWhatsAppShare({
        estimateId: whatsappField("estimate").value,
        organizationId: whatsappField("organization").value.trim(),
        branchId: whatsappField("branch").value.trim(),
      });
      whatsappMessage.textContent = `Opening WhatsApp for ${delivery.phone}. Final Send remains under your control.`;
      window.location.assign(delivery.share_url);
    } catch (error) {
      whatsappMessage.textContent = error instanceof Error ? error.message : "WhatsApp share could not be prepared.";
    } finally {
      button.disabled = false;
    }
  });
}

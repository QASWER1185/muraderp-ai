import { buildAiReview } from "./ai-experience.js";

const sections = [
  ["dashboard", "Dashboard"], ["customers", "Customers"], ["vendors", "Vendors"],
  ["products", "Products"], ["warehouses", "Warehouses"], ["inventory", "Inventory"],
  ["purchases", "Purchases"], ["estimates", "Estimates"], ["invoices", "Invoices"],
  ["returns", "Returns"], ["payments", "Payments"], ["rates", "Rate Lists"],
  ["accounting", "Accounting"], ["reports", "Reports"],
];
const nav = document.querySelector("#nav");
const content = document.querySelector("#content");
const title = document.querySelector("#page-title");
const shell = document.querySelector(".app-shell");

function renderNav(active) {
  nav.replaceChildren(...sections.map(([id, label]) => {
    const button = document.createElement("button");
    button.className = `nav-item${id === active ? " active" : ""}`;
    button.textContent = label;
    button.type = "button";
    button.addEventListener("click", () => navigate(id));
    return button;
  }));
}
function card(label, value, note) {
  return `<article class="card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="muted">${note}</div></article>`;
}
function table(titleText, columns, rows) {
  return `<div class="section-head"><h2>${titleText}</h2><button class="button secondary" type="button">View all</button></div><div class="card table-wrap"><table class="table"><thead><tr>${columns.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function dashboard() {
  return `<div class="grid stats">${card("Sales today", "—", "Connect live sales data")}${card("Receivables", "—", "Connect live customer balances")}${card("Stock value", "—", "Connect live inventory valuation")}${card("Gross profit", "—", "Connect live accounting data")}</div><div class="section-head"><h2>Quick actions</h2></div><div class="grid quick-grid">${[["New Estimate","Start a customer estimate"],["New Invoice","Create a sales invoice"],["Record Purchase","Post supplier stock"],["AI Copilot","Describe an ERP task"],["Customer Payment","Record a receipt"],["Stock Adjustment","Review inventory movement"]].map(([a,b])=>`<button class="card quick-action" data-ai-action="${a === "AI Copilot" ? "copilot" : ""}" type="button"><strong>${a}</strong><span class="muted">${b}</span></button>`).join("")}</div>${table("Recent activity",["Reference","Type","Customer / Vendor","Amount","Status"],[["—","—","Connect live ERP data","—",'<span class="badge">Ready</span>']])}`;
}
function generic(label) {
  return `<div class="card"><div class="section-head"><div><p class="eyebrow">ERP workspace</p><h2>${label}</h2></div><button class="button primary" type="button">+ New ${label.slice(0,-1) || label}</button></div><p class="muted">This production surface uses the authoritative ERP service boundary. Financial, inventory, pricing and transaction rules remain on the backend.</p></div>${table(`Recent ${label.toLowerCase()}`,["ID","Name / Reference","Status","Updated"],[["—","Ready for live data","Connected",new Date().toLocaleDateString()]])}`;
}
function navigate(id) {
  const label = sections.find(([section]) => section === id)?.[1] ?? "Dashboard";
  title.textContent = label;
  renderNav(id);
  content.innerHTML = id === "dashboard" ? dashboard() : generic(label);
  shell.classList.remove("menu-open");
  document.querySelectorAll("[data-ai-action='copilot']").forEach((el) => el.addEventListener("click", () => dialog.showModal()));
}

document.querySelector("#menu").addEventListener("click", () => shell.classList.toggle("menu-open"));
const dialog = document.querySelector("#copilot");
const result = document.querySelector("#copilot-result");
document.querySelector("#copilot-button").addEventListener("click", () => dialog.showModal());
document.querySelector("#copilot-close").addEventListener("click", () => dialog.close());
document.querySelector("#copilot-run").addEventListener("click", () => {
  try {
    const input = document.querySelector("#copilot-input").value.trim();
    const action = document.querySelector("#copilot-action")?.value || "estimate";
    const rateListId = document.querySelector("#copilot-rate-list")?.value || null;
    const review = buildAiReview({ text: input, action, rateListId, inputType: "text" });
    result.hidden = false;
    result.textContent = `${review.action.toUpperCase()} REVIEW REQUIRED\n\n${review.instruction}\n\n${review.note}\n\nNo transaction has been executed. Explicit confirmation and the authoritative ERP service are required.`;
  } catch (error) {
    result.hidden = false;
    result.textContent = error instanceof Error ? error.message : "Unable to prepare AI request.";
  }
});
navigate("dashboard");

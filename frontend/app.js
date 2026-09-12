import { signIn, getSession, signOut } from "./auth.js";
import { mountCopilot } from "./copilot-ui.js";
import { mountEstimateConversion } from "./estimate-conversion.js";
import { mountCustomers } from "./customers.js";
import { mountVendors } from "./vendors.js";
import { flushOfflineQueue, getOfflineState, subscribeOfflineState } from "./offline-sync.js";

const sections = [["dashboard", "Dashboard"], ["customers", "Customers"], ["vendors", "Vendors"], ["products", "Products"], ["warehouses", "Warehouses"], ["inventory", "Inventory"], ["purchases", "Purchases"], ["estimates", "Estimates"], ["invoices", "Invoices"], ["returns", "Returns"], ["payments", "Payments"], ["rates", "Rate Lists"], ["accounting", "Accounting"], ["reports", "Reports"]];
const nav = document.querySelector("#nav"); const content = document.querySelector("#content"); const title = document.querySelector("#page-title"); const shell = document.querySelector(".app-shell"); const connectionStatus = document.querySelector("#connection-status");
let authenticatedUserId = null;

function renderNav(active) { nav.replaceChildren(...sections.map(([id, label]) => { const button = document.createElement("button"); button.className = `nav-item${id === active ? " active" : ""}`; button.textContent = label; button.type = "button"; button.addEventListener("click", () => navigate(id)); return button; })); }
function card(label, value, note) { return `<article class="card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="muted">${note}</div></article>`; }
function table(titleText, columns, rows) { return `<div class="section-head"><h2>${titleText}</h2><button class="button secondary" type="button">View all</button></div><div class="card table-wrap"><table class="table"><thead><tr>${columns.map((column) => `<th>${column}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`; }
function dashboard() { return `<div class="grid stats">${card("Sales today", "—", "Connect live sales data")}${card("Receivables", "—", "Connect live customer balances")}${card("Stock value", "—", "Connect live inventory valuation")}${card("Gross profit", "—", "Connect live accounting data")}</div><div class="section-head"><h2>Quick actions</h2></div><div class="grid quick-grid">${[["New Estimate", "Start a customer estimate"], ["New Invoice", "Create a sales invoice"], ["Record Purchase", "Post supplier stock"], ["AI Copilot", "Describe an ERP task"], ["Customer Payment", "Record a receipt"], ["Stock Adjustment", "Review inventory movement"]].map(([action, note]) => `<button class="card quick-action" data-ai-action="${action === "AI Copilot" ? "copilot" : ""}" type="button"><strong>${action}</strong><span class="muted">${note}</span></button>`).join("")}</div>${table("Recent activity", ["Reference", "Type", "Customer / Vendor", "Amount", "Status"], [["—", "—", "Connect live ERP data", "—", '<span class="badge">Ready</span>']])}`; }
function generic(label) { return `<div class="card"><div class="section-head"><div><p class="eyebrow">ERP workspace</p><h2>${label}</h2></div><button class="button primary" type="button">+ New ${label.slice(0, -1) || label}</button></div><p class="muted">This production surface uses the authoritative ERP service boundary. Financial, inventory, pricing and transaction rules remain on the backend.</p></div>${table(`Recent ${label.toLowerCase()}`, ["ID", "Name / Reference", "Status", "Updated"], [["—", "Ready for live data", "Connected", new Date().toLocaleDateString()]])}`; }

function navigate(id) { const label = sections.find(([section]) => section === id)?.[1] ?? "Dashboard"; title.textContent = label; renderNav(id); content.innerHTML = id === "dashboard" ? dashboard() : generic(label); if (id === "customers") mountCustomers(content); if (id === "vendors") mountVendors(content); if (id === "estimates") mountEstimateConversion(content); shell.classList.remove("menu-open"); document.querySelectorAll("[data-ai-action='copilot']").forEach((element) => element.addEventListener("click", () => copilotUi.open())); }
function value(selector) { return document.querySelector(selector)?.value.trim() || ""; }
async function updateConnectionStatus() { const state = await getOfflineState(); if (!connectionStatus) return; connectionStatus.textContent = state.online ? `Online${state.pending ? ` · ${state.pending} queued` : ""}` : `Offline${state.pending ? ` · ${state.pending} queued` : ""}`; connectionStatus.classList.toggle("offline", !state.online); }

const copilotUi = mountCopilot({
  getAuthenticatedUserId: () => authenticatedUserId,
  openNativeAction: (intent, recordId) => {
    const section = ({ estimate: "estimates", customer_create: "customers", vendor_create: "vendors", supplier_bill: "purchases", customer_return: "returns", rate_list_update: "rates", customer_payment: "payments", vendor_payment: "payments" })[intent] ?? "dashboard";
    navigate(section);
    if (intent === "estimate") {
      const sourceInput = content.querySelector('input[name="source"]');
      if (sourceInput) { sourceInput.value = String(recordId); sourceInput.focus(); }
    }
  },
});
document.querySelector("#menu").addEventListener("click", () => shell.classList.toggle("menu-open"));

const authDialog = document.querySelector("#auth-dialog"); const authButton = document.querySelector("#auth-button"); const authResult = document.querySelector("#auth-result");
authButton.addEventListener("click", () => authDialog.showModal()); document.querySelector("#auth-close").addEventListener("click", () => authDialog.close());
document.querySelector("#auth-submit").addEventListener("click", async () => { try { const session = await signIn(value("#auth-email"), value("#auth-password")); authenticatedUserId = session.user?.id ?? null; authResult.hidden = false; authResult.textContent = "Authenticated ERP session established."; authButton.textContent = "Signed in"; document.querySelector("#auth-signout").hidden = false; updateConnectionStatus(); } catch (error) { authResult.hidden = false; authResult.textContent = error instanceof Error ? error.message : "Unable to sign in."; } });
document.querySelector("#auth-signout").addEventListener("click", async () => { await signOut(); authenticatedUserId = null; authButton.textContent = "Sign in"; document.querySelector("#auth-signout").hidden = true; authResult.hidden = false; authResult.textContent = "Signed out."; copilotUi.reset(); navigate("dashboard"); });
getSession().then((session) => { authenticatedUserId = session?.data?.userId ?? null; authButton.textContent = authenticatedUserId ? "Signed in" : "Sign in"; }).catch(() => { authenticatedUserId = null; });
subscribeOfflineState(updateConnectionStatus);
navigate("dashboard"); updateConnectionStatus(); void flushOfflineQueue().then(updateConnectionStatus);

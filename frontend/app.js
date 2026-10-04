import { signIn, getSession, signOut } from "./auth.js";
import { mountCopilot } from "./copilot-ui.js";
import { mountEstimates } from "./estimates.js";
import { mountCustomers } from "./customers.js";
import { mountVendors } from "./vendors.js";
import { mountProducts } from "./products.js";
import { mountInvoices } from "./invoices.js";
import { mountReturns } from "./returns.js";
import { mountPurchases } from "./purchases.js";
import { mountWarehouses } from "./warehouses.js";
import { mountStock } from "./stock.js";
import { mountPayments } from "./payments.js";
import { mountVendorPayments } from "./vendor-payments.js";
import { mountRateLists } from "./rate-lists.js";
import { mountAccounting } from "./accounting.js";
import { mountReports } from "./reports.js";
import { dashboardMarkup, mountDashboard } from "./dashboard.js";
import { icon } from "./icons.js";
import { authorizedWorkspace, clearWorkspaceContext, connectPreferredWorkspace, getWorkspaceContext, preferredWorkspace, setWorkspaceContext } from "./workspace-context.js";
import { flushOfflineQueue, getOfflineState, subscribeOfflineState } from "./offline-sync.js";

const groups = [
  ["Overview", [["dashboard", "Dashboard", "dashboard"]]],
  ["Sales", [["customers", "Customers", "users"], ["estimates", "Estimates", "file"], ["invoices", "Invoices", "receipt"], ["returns", "Returns", "return"]]],
  ["Purchasing", [["vendors", "Vendors", "building"], ["purchases", "Purchases", "cart"], ["vendor-payments", "Vendor Payments", "wallet"]]],
  ["Inventory", [["products", "Products", "package"], ["warehouses", "Warehouses", "warehouse"], ["inventory", "Stock", "boxes"], ["rates", "Rate Lists", "tags"]]],
  ["Finance", [["payments", "Payments", "wallet"], ["accounting", "Accounting", "receipt"], ["reports", "Reports", "chart"]]],
];
const sections = groups.flatMap(([, items]) => items);
const AUTHENTICATED_API_BOUNDARY = "/api/v1/";
void AUTHENTICATED_API_BOUNDARY;
const nav = document.querySelector("#nav");
const content = document.querySelector("#content");
const title = document.querySelector("#page-title");
const shell = document.querySelector(".app-shell");
const connectionStatus = document.querySelector("#connection-status");
let authenticatedUserId = null;
let currentSection = "dashboard";

function renderNav(active) {
  nav.innerHTML = `<div class="brand"><span class="brand-symbol">M</span><span><strong>MuradERP</strong><small>Business workspace</small></span></div>${groups.map(([label, items]) => `<div class="nav-group"><p>${label}</p>${items.map(([id, name, iconName]) => `<button class="nav-item${id === active ? " active" : ""}" type="button" data-route="${id}">${icon(iconName)}<span>${name}</span></button>`).join("")}</div>`).join("")}<button class="nav-copilot" type="button" data-open-copilot>${icon("sparkles")}<span><strong>Ask Copilot</strong><small>Ask or prepare an action</small></span></button>`;
}

function unavailableMarkup(label) {
  return `<section class="page-heading"><div><p class="eyebrow">ERP workspace</p><h1>${label}</h1><p class="page-intro">This module is not available in the browser yet.</p></div></section><section class="surface"><div class="empty-state">${icon("building", 26)}<h2>Browser access not configured</h2><p>The authoritative backend does not currently expose a verified browser workflow for ${label.toLowerCase()}. No live status or sample records are being shown.</p></div></section>`;
}

function navigate(routeId) {
  currentSection = sections.some(([section]) => section === routeId) ? routeId : "dashboard";
  const label = sections.find(([section]) => section === currentSection)?.[1] ?? "Dashboard";
  title.textContent = label;
  renderNav(currentSection);
  content.innerHTML = currentSection === "dashboard" ? dashboardMarkup() : unavailableMarkup(label);
  const id=currentSection;
  if(id==="dashboard")mountDashboard(content);
  if(id==="customers")mountCustomers(content);
  if(id==="vendors")mountVendors(content);
  if(id==="products")mountProducts(content);
  if(id==="invoices")mountInvoices(content);
  if(id==="returns")mountReturns(content);
  if(id==="purchases")mountPurchases(content);
  if(id==="warehouses")mountWarehouses(content);
  if(id==="inventory")mountStock(content);
  if(id==="payments")mountPayments(content);
  if(id==="vendor-payments")mountVendorPayments(content);
  if(id==="rates")mountRateLists(content);
  if(id==="accounting")mountAccounting(content);
  if(id==="reports")mountReports(content);
  if(id==="estimates")mountEstimates(content);
  shell.classList.remove("menu-open");
  content.focus({ preventScroll: true });
}

function value(selector) { return document.querySelector(selector)?.value.trim() || ""; }
async function updateConnectionStatus() {
  const state = await getOfflineState();
  connectionStatus.textContent = state.online ? (state.pending ? `Network online, ${state.pending} queued` : "Network online") : (state.pending ? `Network offline, ${state.pending} queued` : "Network offline");
  connectionStatus.classList.toggle("offline", !state.online);
}

const copilotUi = mountCopilot({
  getAuthenticatedUserId: () => authenticatedUserId,
  openNativeAction: (intent, recordId) => {
    const section = ({ estimate: "estimates", supplier_bill: "purchases", customer_return: "returns", rate_list_update: "rates" })[intent] ?? "dashboard";
    navigate(section);
    if (intent === "estimate") { const sourceInput = content.querySelector('input[name="source"]'); if (sourceInput) { sourceInput.value = String(recordId); sourceInput.focus(); } }
  },
});
const resetDraft=()=>copilotUi.reset();

document.addEventListener("click", (event) => {
  const routeButton = event.target.closest("[data-route], [data-navigate]");
  const route = routeButton?.dataset.route ?? routeButton?.dataset.navigate;
  if (route) navigate(route);
  if (event.target.closest("[data-open-copilot]")) copilotUi.open();
});
document.querySelector("#menu").addEventListener("click", () => shell.classList.toggle("menu-open"));
document.querySelector("#nav-scrim").addEventListener("click", () => shell.classList.remove("menu-open"));
document.querySelector("#menu").innerHTML = icon("menu");
document.querySelector("#workspace-button").innerHTML = icon("building");
document.querySelector("#copilot-button").innerHTML = `${icon("sparkles")}<span>Copilot</span>`;
document.querySelector("#auth-close").innerHTML = icon("close");
document.querySelector("#workspace-close").innerHTML = icon("close");

const authDialog = document.querySelector("#auth-dialog");
const authForm = document.querySelector("#auth-form");
const authButton = document.querySelector("#auth-button");
const authResult = document.querySelector("#auth-result");
authButton.addEventListener("click", () => authDialog.showModal());
document.querySelector("#auth-close").addEventListener("click", () => authDialog.close());
authForm.addEventListener("submit", async (event) => {
  event.preventDefault(); authResult.hidden = true;
  try { const session = await signIn(value("#auth-email"), value("#auth-password")); authenticatedUserId = session.user?.id ?? null; clearWorkspaceContext(); authResult.textContent = "Signed in securely."; authResult.hidden = false; authButton.textContent = "Account"; document.querySelector("#auth-signout").hidden = false; authDialog.close(); await connectDiscoveredWorkspace(); }
  catch (error) { authResult.textContent = error instanceof Error ? error.message : "Unable to sign in."; authResult.hidden = false; }
});
document.querySelector("#auth-signout").addEventListener("click", async () => { await signOut(); authenticatedUserId = null; clearWorkspaceContext(); availableWorkspaces = []; authButton.textContent = "Sign in"; document.querySelector("#auth-signout").hidden = true; authResult.textContent = "Signed out."; authResult.hidden = false; resetDraft();navigate("dashboard"); });

const workspaceDialog = document.querySelector("#workspace-dialog");
const workspaceForm = document.querySelector("#workspace-form");
const workspaceResult = document.querySelector("#workspace-result");
let availableWorkspaces = [];
function option(value, label) { const item = document.createElement("option"); item.value = value; item.textContent = label; return item; }
function renderBranchOptions(preferredBranchId = "") {
  const organization = availableWorkspaces.find((item) => item.organizationId === workspaceForm.elements.organization.value);
  workspaceForm.elements.branch.replaceChildren(option("", "Choose branch"), ...(organization?.branches ?? []).map((branch) => option(branch.branchId, branch.branchName)));
  workspaceForm.elements.branch.value = organization?.branches?.some((branch) => branch.branchId === preferredBranchId) ? preferredBranchId : organization?.branches?.[0]?.branchId ?? "";
}
function renderWorkspaceOptions(preferred = getWorkspaceContext()) {
  workspaceForm.elements.organization.replaceChildren(option("", "Choose organization"), ...availableWorkspaces.map((organization) => option(organization.organizationId, organization.organizationName)));
  const selected = preferredWorkspace(availableWorkspaces, preferred);
  workspaceForm.elements.organization.value = selected?.organizationId ?? "";
  renderBranchOptions(selected?.branchId);
}
async function connectDiscoveredWorkspace(previous = null) {
  try {
    const { workspaces, selected } = await connectPreferredWorkspace(previous);
    availableWorkspaces = workspaces;
    renderWorkspaceOptions(selected);
    workspaceResult.hidden = Boolean(selected);
    if (!selected) workspaceResult.textContent = "No active organization and branch assignment is available for this account.";
    navigate(currentSection);
  } catch (error) {
    availableWorkspaces = [];
    clearWorkspaceContext();
    workspaceResult.textContent = error?.status === 401 ? "Sign in to discover your workspaces." : error instanceof Error ? error.message : "Workspaces could not be loaded.";
    workspaceResult.hidden = false;
    if (!workspaceDialog.open) workspaceDialog.showModal();
    navigate(currentSection);
  }
}
function openWorkspace() {
  renderWorkspaceOptions();
  workspaceResult.hidden = availableWorkspaces.length > 0;
  if (!availableWorkspaces.length) workspaceResult.textContent = authenticatedUserId ? "No workspaces loaded. Refresh to try again." : "Sign in to discover your workspaces.";
  if (!workspaceDialog.open) workspaceDialog.showModal();
  if (authenticatedUserId && !availableWorkspaces.length) void connectDiscoveredWorkspace(getWorkspaceContext());
}
document.querySelector("#workspace-button").addEventListener("click", openWorkspace);
document.querySelector("#workspace-close").addEventListener("click", () => workspaceDialog.close());
document.querySelector("#workspace-refresh").addEventListener("click", () => void connectDiscoveredWorkspace(getWorkspaceContext()));
workspaceForm.elements.organization.addEventListener("change", () => renderBranchOptions());
workspaceForm.addEventListener("submit", (event) => { event.preventDefault(); const selected = authorizedWorkspace(availableWorkspaces, workspaceForm.elements.organization.value, workspaceForm.elements.branch.value); if (!selected) { workspaceResult.textContent = "Choose an authorized organization and branch."; workspaceResult.hidden = false; return; } setWorkspaceContext(selected); workspaceDialog.close(); navigate(currentSection); });
globalThis.addEventListener("muraderp:open-workspace", openWorkspace);

const previousWorkspace = getWorkspaceContext();
clearWorkspaceContext();
getSession().then(async (session) => { authenticatedUserId = session?.data?.userId ?? null; authButton.textContent = authenticatedUserId ? "Account" : "Sign in"; document.querySelector("#auth-signout").hidden = !authenticatedUserId; if (authenticatedUserId) await connectDiscoveredWorkspace(previousWorkspace); }).catch(() => { authenticatedUserId = null; authButton.textContent = "Sign in"; });
subscribeOfflineState(updateConnectionStatus);
navigate("dashboard"); updateConnectionStatus(); void flushOfflineQueue().then(updateConnectionStatus);

import { signIn, getSession, signOut } from "./auth.js";
import { mountCopilot } from "./copilot-ui.js?v=20261031_quota48";
import { mountEstimateWorkspace } from "./estimate-register.js";
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
import { dashboardMarkup, mountDashboard } from "./dashboard.js?v=20261031_quota48";
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
let content = document.querySelector("#content");
const title = document.querySelector("#page-title");
const shell = document.querySelector(".app-shell");
const connectionStatus = document.querySelector("#connection-status");
let authenticatedUserId = null;
const routeFromLocation = () => globalThis.location.hash.replace(/^#\/?/, "") || "dashboard";
let currentSection = routeFromLocation();

function renderNav(active) {
  const brandName = active === "dashboard" ? "MURAD" : "MuradERP";
  const brandSubtitle = active === "dashboard" ? "Building Material Store" : "Business workspace";
  nav.innerHTML = `<div class="brand"><span class="brand-symbol">M</span><span><strong>${brandName}</strong><small>${brandSubtitle}</small></span></div>${groups.map(([label, items]) => `<div class="nav-group"><p>${label}</p>${items.map(([id, name, iconName]) => `<button class="nav-item${id === active ? " active" : ""}" type="button" data-route="${id}">${icon(iconName)}<span>${name}</span></button>`).join("")}</div>`).join("")}<button class="nav-copilot" type="button" data-open-copilot>${icon("sparkles")}<span><strong>Ask Copilot</strong><small>Ask or prepare an action</small></span></button>`;
  // Bind the controls themselves: navigation must not depend on a click
  // reaching document (including keyboard/assistive activation).
  nav.querySelectorAll("[data-route]").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.route === active ? "page" : "false");
    button.addEventListener("click", () => navigate(button.dataset.route));
  });
}

const mobileNav = document.querySelector("#mobile-bottom-nav");
if (mobileNav) {
  mobileNav.querySelectorAll("[data-icon]").forEach((node) => { node.innerHTML = icon(node.dataset.icon, 20); });
}
const themeColor = document.querySelector('meta[name="theme-color"]');
const mobileTheme = globalThis.matchMedia?.("(max-width: 720.99px)");
function applyViewportTheme() { if (themeColor) themeColor.content = mobileTheme?.matches ? "#0E2E4F" : "#007AB7"; }
applyViewportTheme();
mobileTheme?.addEventListener?.("change", applyViewportTheme);
function updateMobileNav(active = currentSection) {
  const section = String(active).split("/")[0];
  const copilotOpen = Boolean(document.querySelector("#copilot")?.open);
  mobileNav?.querySelectorAll("button").forEach((button) => {
    const route = button.dataset.navigate?.split("/")[0];
    button.classList.toggle("active", route ? !copilotOpen && route === section : button.hasAttribute("data-open-copilot") && copilotOpen);
  });
}

function unavailableMarkup(label) {
  return `<section class="page-heading"><div><p class="eyebrow">ERP workspace</p><h1>${label}</h1><p class="page-intro">This module is not available in the browser yet.</p></div></section><section class="surface"><div class="empty-state">${icon("building", 26)}<h2>Browser access not configured</h2><p>The authoritative backend does not currently expose a verified browser workflow for ${label.toLowerCase()}. No live status or sample records are being shown.</p></div></section>`;
}

function navigate(routeId, updateHistory = true) {
  const baseRoute = String(routeId).split("/")[0];
  currentSection = sections.some(([section]) => section === baseRoute) ? routeId : "dashboard";
  const hash = `#/${currentSection}`;
  if (updateHistory && globalThis.location.hash !== hash) {
    globalThis.history[globalThis.location.hash ? "pushState" : "replaceState"](null, "", hash);
  }
  const label = sections.find(([section]) => section === currentSection.split("/")[0])?.[1] ?? "Dashboard";
  title.textContent = label;
  renderNav(currentSection.split("/")[0]);
  updateMobileNav(currentSection);
  // Page modules bind listeners and retain async render targets. Give each
  // mount its own container so an old page cannot handle or overwrite it.
  const nextContent = content.cloneNode(false);
  content.replaceWith(nextContent);
  content = nextContent;
  content.innerHTML = currentSection === "dashboard" ? dashboardMarkup() : unavailableMarkup(label);
  const id=currentSection.split("/")[0];
  if(id==="dashboard")mountDashboard(content);
  if(id==="customers")mountCustomers(content);
  if(id==="vendors")mountVendors(content);
  if(id==="products")mountProducts(content);
  if(id==="invoices")mountInvoices(content,{sourceEstimateId:currentSection.startsWith("invoices/from-estimate/")?Number(currentSection.split("/")[2]):undefined,invoiceId:/^invoices\/\d+$/.test(currentSection)?Number(currentSection.split("/")[1]):undefined});
  if(id==="returns")mountReturns(content,{returnId:/^returns\/\d+$/.test(currentSection)?Number(currentSection.split("/")[1]):undefined});
  if(id==="purchases")mountPurchases(content);
  if(id==="warehouses")mountWarehouses(content);
  if(id==="inventory")mountStock(content);
  if(id==="payments")mountPayments(content,{paymentId:/^payments\/\d+$/.test(currentSection)?Number(currentSection.split("/")[1]):undefined,sourceInvoiceId:/^payments\/from-invoice\/\d+$/.test(currentSection)?Number(currentSection.split("/")[2]):undefined});
  if(id==="vendor-payments")mountVendorPayments(content);
  if(id==="rates")mountRateLists(content);
  if(id==="accounting")mountAccounting(content);
  if(id==="reports")mountReports(content);
  if(id==="estimates")mountEstimateWorkspace(content,{route:currentSection});
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
    const section = ({ estimate: "estimates", supplier_bill: "purchases", customer_return: "returns", rate_list_update: "rates", customer_payment: "payments", vendor_payment: "vendor-payments" })[intent] ?? "dashboard";
    navigate(section);
    if (intent === "estimate" && Number.isSafeInteger(Number(recordId))) { navigate(`estimates/${recordId}`); return; }
    if (intent === "estimate") { const sourceInput = content.querySelector('input[name="source"]'); if (sourceInput) { sourceInput.value = String(recordId); sourceInput.focus(); } }
  },
});
const resetDraft=()=>copilotUi.reset();

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  const route = target?.closest("[data-navigate]")?.dataset.navigate;
  if (route) navigate(route);
  if (target?.closest("[data-open-new-invoice]")) {
    navigate("invoices");
    queueMicrotask(() => content.querySelector("[data-invoice-new]")?.click());
  }
  if (target?.closest("[data-open-new-customer]")) {
    navigate("customers");
    queueMicrotask(() => content.dispatchEvent(new Event("muraderp:customer-new")));
  }
  if (target?.closest("[data-open-copilot]")) { copilotUi.open(); updateMobileNav(); }
});
document.querySelector("#copilot")?.addEventListener("close", () => updateMobileNav());
globalThis.addEventListener("popstate", () => navigate(routeFromLocation(), false));
globalThis.addEventListener("hashchange", () => navigate(routeFromLocation(), false));
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
  const submit = document.querySelector("#auth-submit");
  if (submit.disabled) return;
  submit.disabled = true; submit.textContent = "Signing in…";
  try { const session = await signIn(value("#auth-email"), document.querySelector("#auth-password").value); authenticatedUserId = session.user?.id ?? null; clearWorkspaceContext(); authResult.textContent = "Signed in securely."; authResult.hidden = false; authButton.textContent = "Account"; document.querySelector("#auth-signout").hidden = false; document.querySelector("#auth-password").value = ""; authDialog.close(); await connectDiscoveredWorkspace(); }
  catch (error) {
    // Keep the original browser error visible in DevTools so network, CORS,
    // and Auth failures can be distinguished without logging form values.
    console.error("[MuradERP] Supabase sign-in failed:", error);
    authResult.textContent = error instanceof Error ? error.message : "Unable to sign in.";
    authResult.hidden = false;
  }
  finally { submit.disabled = false; submit.textContent = "Sign in"; }
});
document.querySelector("#auth-signout").addEventListener("click", async () => { await signOut(); authenticatedUserId = null; clearWorkspaceContext(); availableWorkspaces = []; authButton.textContent = "Sign in"; document.querySelector("#auth-signout").hidden = true; authResult.textContent = "Signed out."; authResult.hidden = false; resetDraft();navigate("dashboard"); });

const workspaceDialog = document.querySelector("#workspace-dialog");
const workspaceForm = document.querySelector("#workspace-form");
const workspaceResult = document.querySelector("#workspace-result");
let availableWorkspaces = [];
let workspaceRequest = 0;
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
  const requestId = ++workspaceRequest;
  const userId = authenticatedUserId;
  const refresh = document.querySelector("#workspace-refresh");
  refresh.disabled = true;
  try {
    const { workspaces, selected } = await connectPreferredWorkspace(previous, globalThis.sessionStorage, () => requestId === workspaceRequest && userId === authenticatedUserId);
    if (requestId !== workspaceRequest || userId !== authenticatedUserId) return;
    availableWorkspaces = workspaces;
    renderWorkspaceOptions(selected);
    const organization = workspaces.find(item => item.organizationId === selected?.organizationId);
    const workspaceButton = document.querySelector("#workspace-button");
    workspaceButton.replaceChildren();
    const label = document.createElement("span");
    label.textContent = organization?.organizationName ?? "Choose workspace";
    workspaceButton.append(label);
    workspaceButton.title = organization?.organizationName ?? "Choose workspace";
    workspaceResult.hidden = Boolean(selected);
    if (!selected) workspaceResult.textContent = "No active organization and branch assignment is available for this account.";
    navigate(currentSection);
  } catch (error) {
    if (requestId !== workspaceRequest || userId !== authenticatedUserId) return;
    availableWorkspaces = [];
    clearWorkspaceContext();
    workspaceResult.textContent = error?.status === 401 ? "Sign in to discover your workspaces." : error instanceof Error ? error.message : "Workspaces could not be loaded.";
    workspaceResult.hidden = false;
    if (!workspaceDialog.open) workspaceDialog.showModal();
    navigate(currentSection);
  }
  finally { if (requestId === workspaceRequest) refresh.disabled = false; }
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
async function restoreSession() { try { const session=await getSession(); authenticatedUserId=session?.data?.userId??null; authButton.textContent=authenticatedUserId?"Account":"Sign in"; document.querySelector("#auth-signout").hidden=!authenticatedUserId; if(authenticatedUserId){await connectDiscoveredWorkspace(previousWorkspace);void flushOfflineQueue().then(updateConnectionStatus);} else navigate(currentSection); } catch(error) {content.innerHTML='<div class="empty-state"><h2>Session temporarily unavailable</h2><p>Your session has not been cleared.</p><button class="button secondary" data-session-retry>Try again</button></div>';content.querySelector("[data-session-retry]").onclick=()=>void restoreSession();} }
void restoreSession();
subscribeOfflineState(updateConnectionStatus);
content.innerHTML = '<div class="loading-state" role="status">Restoring your secure session…</div>'; updateConnectionStatus();

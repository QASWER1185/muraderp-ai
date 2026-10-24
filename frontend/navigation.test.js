// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./auth.js", () => ({ signIn: vi.fn(), signOut: vi.fn(), getSession: async () => null }));
vi.mock("./copilot-ui.js", () => ({ mountCopilot: () => ({ open: vi.fn(), reset: vi.fn() }) }));
vi.mock("./offline-sync.js", () => ({
  flushOfflineQueue: async () => {}, getOfflineState: async () => ({ online: true, pending: 0 }), subscribeOfflineState: vi.fn(),
}));

describe("application navigation with mounted page components", () => {
  beforeAll(async () => {
    history.replaceState(null, "", "#/customers");
    document.body.innerHTML = readFileSync(new NodeURL("./index.html", import.meta.url), "utf8").match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
    await import("./app.js");
  });

  it("mounts the initial deep link instead of resetting to Dashboard", () => {
    expect(document.querySelector("#page-title").textContent).toBe("Customers");
    expect(document.querySelector("#customer-panel")).not.toBeNull();
  });

  it.each([["customers", "Customers", "#customer-panel"], ["inventory", "Stock", "#stock-balances"], ["estimates", "Estimates", "[data-estimate-results]"], ["invoices", "Invoices", "#invoice-results"]])(
    "mounts %s from a nested sidebar label and keeps it active", async (route, label, panel) => {
      document.querySelector(`#nav [data-route="${route}"] span`).click();
      await Promise.resolve();
      expect(document.querySelector("#page-title").textContent).toBe(label);
      expect(document.querySelector("#nav .active").dataset.route).toBe(route);
      expect(document.querySelector(`#content ${panel}`)).not.toBeNull();
      expect(location.hash).toBe(`#/${route}`);
      expect(document.querySelector("#nav .active").getAttribute("aria-current")).toBe("page");
    },
  );
  it("routes direct control activation without relying on document bubbling", () => {
    document.querySelector('#nav [data-route="customers"]').dispatchEvent(new MouseEvent("click", { bubbles: false }));
    expect(document.querySelector("#page-title").textContent).toBe("Customers");
    expect(document.querySelector("#customer-panel")).not.toBeNull();
  });
  it("restores a view after a hash change or browser history navigation", () => {
    history.replaceState(null, "", "#/inventory");
    dispatchEvent(new PopStateEvent("popstate"));
    expect(document.querySelector("#stock-balances")).not.toBeNull();
    location.hash = "#/invoices";
    dispatchEvent(new HashChangeEvent("hashchange"));
    expect(document.querySelector("#page-title").textContent).toBe("Invoices");
  });

  it("routes dashboard actions and closes the mobile menu", () => {
    document.querySelector('.app-shell').classList.add("menu-open");
    const action = document.createElement("button");
    action.dataset.navigate = "estimates/create";
    action.innerHTML = "<span>Create estimate</span>";
    document.body.append(action);
    action.querySelector("span").click();
    action.remove();
    expect(document.querySelector("#estimate-lines")).not.toBeNull();
    expect(document.querySelector('.app-shell').classList.contains("menu-open")).toBe(false);
    expect(document.querySelector("#customer-panel")).toBeNull();
    expect(document.querySelector("#invoice-results")).toBeNull();
  });

  it("isolates the active view from old page handlers and delayed renders", () => {
    document.querySelector('#nav [data-route="inventory"]').click();
    const oldPage = document.querySelector("#content");
    const oldHandler = vi.fn();
    oldPage.addEventListener("click", oldHandler);
    document.querySelector('#nav [data-route="invoices"]').click();
    document.querySelector("#content").click();
    oldPage.innerHTML = "Late stock response";
    expect(oldHandler).not.toHaveBeenCalled();
    expect(document.querySelector("#invoice-results")).not.toBeNull();
    expect(document.querySelector("#content").textContent).not.toContain("Late stock response");
  });
});

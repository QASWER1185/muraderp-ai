const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIMARY_KEY = "muraderp.workspace-context";
const LEGACY_KEYS = ["muraderp.customer-context", "muraderp.vendor-context"];

export function normalizeWorkspaceContext(value) {
  const organizationId = String(value?.organizationId ?? "").trim();
  const branchId = String(value?.branchId ?? "").trim();
  if (!UUID_PATTERN.test(organizationId) || !UUID_PATTERN.test(branchId)) return null;
  return { organizationId, branchId };
}

export function getWorkspaceContext(storage = globalThis.sessionStorage) {
  for (const key of [PRIMARY_KEY, ...LEGACY_KEYS]) {
    try {
      const context = normalizeWorkspaceContext(JSON.parse(storage?.getItem(key) ?? "null"));
      if (context) {
        if (key !== PRIMARY_KEY) storage?.setItem(PRIMARY_KEY, JSON.stringify(context));
        return context;
      }
    } catch {
      // A malformed optional session value is ignored.
    }
  }
  return null;
}

export function setWorkspaceContext(context, storage = globalThis.sessionStorage) {
  const normalized = normalizeWorkspaceContext(context);
  if (!normalized) throw new Error("Enter valid organization and branch identifiers.");
  storage?.setItem(PRIMARY_KEY, JSON.stringify(normalized));
  for (const key of LEGACY_KEYS) storage?.removeItem(key);
  globalThis.dispatchEvent?.(new CustomEvent("muraderp:workspace", { detail: normalized }));
  return normalized;
}

export function clearWorkspaceContext(storage = globalThis.sessionStorage) {
  for (const key of [PRIMARY_KEY, ...LEGACY_KEYS]) storage?.removeItem(key);
  globalThis.dispatchEvent?.(new CustomEvent("muraderp:workspace", { detail: null }));
}

export async function discoverWorkspaces() {
  const response = await fetch("/api/v1/workspaces", { credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.message ?? `Workspace discovery failed with HTTP ${response.status}`);
    error.status = response.status;
    error.code = body?.error?.code;
    throw error;
  }
  return Array.isArray(body.data) ? body.data : [];
}

export function authorizedWorkspace(workspaces, organizationId, branchId) {
  const organization = workspaces.find((item) => item.organizationId === organizationId);
  const branch = organization?.branches?.find((item) => item.branchId === branchId);
  return branch ? { organizationId, branchId } : null;
}

export function preferredWorkspace(workspaces, previous = null) {
  const existing = previous && authorizedWorkspace(workspaces, previous.organizationId, previous.branchId);
  if (existing) return existing;
  for (const organization of workspaces) {
    if (organization.branches?.length) return { organizationId: organization.organizationId, branchId: organization.branches[0].branchId };
  }
  return null;
}

export async function connectPreferredWorkspace(previous = null, storage = globalThis.sessionStorage) {
  const workspaces = await discoverWorkspaces();
  const selected = preferredWorkspace(workspaces, previous);
  if (selected) setWorkspaceContext(selected, storage);
  else clearWorkspaceContext(storage);
  return { workspaces, selected };
}


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
      if (context) return context;
    } catch {
      // A malformed optional session value is ignored.
    }
  }
  return null;
}

export function setWorkspaceContext(context, storage = globalThis.sessionStorage) {
  const normalized = normalizeWorkspaceContext(context);
  if (!normalized) throw new Error("Enter valid organization and branch identifiers.");
  for (const key of [PRIMARY_KEY, ...LEGACY_KEYS]) storage?.setItem(key, JSON.stringify(normalized));
  globalThis.dispatchEvent?.(new CustomEvent("muraderp:workspace", { detail: normalized }));
  return normalized;
}

export function clearWorkspaceContext(storage = globalThis.sessionStorage) {
  for (const key of [PRIMARY_KEY, ...LEGACY_KEYS]) storage?.removeItem(key);
  globalThis.dispatchEvent?.(new CustomEvent("muraderp:workspace", { detail: null }));
}

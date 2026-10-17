import { supabaseConfiguration } from "./supabase-config.js";
import { boundedFetch } from "./request.js";

async function supabaseRequest(path, options = {}) {
  const config = supabaseConfiguration();
  const response = await boundedFetch(`${config.url}${path}`, {
    ...options,
    headers: { apikey: config.key, "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error_description ?? body.msg ?? body.error?.message ?? "Authentication request failed");
  return body;
}

export async function signIn(email, password) {
  const session = await supabaseRequest("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
  await boundedFetch("/api/v1/auth/session", { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${session.access_token}` } }).then(async (response) => {
    if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to establish ERP session");
  });
  return session;
}

export async function getSession() {
  const response = await boundedFetch("/api/v1/auth/session", { credentials: "include" });
  if (!response.ok) return null;
  return response.json();
}

export async function signOut() {
  await boundedFetch("/api/v1/auth/session", { method: "DELETE", credentials: "include" });
}

import { supabaseConfiguration, localDevAuthEnabled } from "./supabase-config.js";
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
  if (localDevAuthEnabled()) {
    const response = await boundedFetch('/api/v1/auth/session', {method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email})});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? 'Local demo sign-in failed');
    return body;
  }
  const session = await supabaseRequest("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
  await boundedFetch("/api/v1/auth/session", { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${session.access_token}` } }).then(async (response) => {
    if (!response.ok) throw new Error((await response.json()).error?.message ?? "Unable to establish ERP session");
  });
  return session;
}

export async function getSession() {
  for (let attempt=0;attempt<2;attempt++) {
    try {
      const response = await boundedFetch("/api/v1/auth/session", { credentials: "include", cache: "no-store" });
      if (response.status===401) return null;
      if (!response.ok) throw new Error('Your secure session is temporarily unavailable. Please retry.');
      return await response.json();
    } catch(error) { if(attempt===1)throw error; }
  }
}

export async function signOut() {
  await boundedFetch("/api/v1/auth/session", { method: "DELETE", credentials: "include" });
}

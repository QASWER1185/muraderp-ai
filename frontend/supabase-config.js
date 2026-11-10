const HOSTED = Object.freeze({ url: "https://pmsowmiivjkwtovynhje.supabase.co", key: "sb_publishable_2m8QbtycXYKeRyFw33iP1w_YNM8E1w8" });

export function localDevAuthEnabled() {
  return globalThis.MURADERP_PUBLIC_CONFIG?.localDevAuth === true && ['localhost', '127.0.0.1', '[::1]'].includes(globalThis.location?.hostname);
}

export function supabaseConfiguration(value = globalThis.MURADERP_PUBLIC_CONFIG) {
  // A partial override must never pair one project's URL with another project's key.
  if (!value?.url?.trim() || !value?.key?.trim()) return HOSTED;
  const url = new URL(value.url.trim());
  const key = value.key.trim();
  if ((url.protocol !== "https:" && !(localDevAuthEnabled() && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Supabase must use a valid hosted HTTPS project URL.");
  if (key.startsWith("sb_secret_")) throw new Error("Only a public Supabase key may be used in the browser.");
  if (!key.startsWith("sb_publishable_") && !key.startsWith("eyJ")) throw new Error("Configure a public Supabase publishable or anon key.");
  if (key.startsWith("eyJ")) {
    let role;
    try { role = JSON.parse(atob(key.split(".")[1].replaceAll("-", "+").replaceAll("_", "/"))).role; } catch {}
    if (role !== "anon") throw new Error("Only a public Supabase anon key may be used in the browser.");
  }
  return { url: url.origin, key };
}

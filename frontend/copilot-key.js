const STORAGE_KEY = "muraderp.copilot.gemini-key.v1";
const validKey = (key) => key.length >= 20 && key.length <= 512 && !/[^\x21-\x7e]/.test(key);

export function getCopilotApiKey(storage) {
  try {
    const key = (storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY)?.trim();
    if (!key || !validKey(key)) { clearCopilotApiKey(storage); return null; }
    return key;
  } catch {
    return null;
  }
}

export function saveCopilotApiKey(value, storage) {
  const key = String(value ?? "").trim();
  if (!key) { clearCopilotApiKey(storage); return; }
  if (!validKey(key)) {
    throw new Error("Enter a valid Gemini API key (20–512 characters, without spaces or control characters).");
  }
  const target = storage ?? globalThis.localStorage;
  if (!target?.setItem) throw new Error("Browser local storage is unavailable.");
  target.setItem(STORAGE_KEY, key);
}

export function clearCopilotApiKey(storage) {
  try { const target = storage ?? globalThis.localStorage; target?.removeItem(STORAGE_KEY); target?.removeItem("copilot_api_key"); } catch {}
}

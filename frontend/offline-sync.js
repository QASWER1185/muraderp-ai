import { enqueueOutbox, listOutbox, removeOutbox, updateOutbox, pendingOutboxCount } from "./offline-store.js";

const listeners = new Set();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeOfflineState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function queueJsonRequest({ endpoint, method = "POST", headers = {}, body, kind }) {
  const item = await enqueueOutbox({ endpoint, method, headers, body, kind });
  notify();
  if (navigator.onLine) void flushOfflineQueue();
  return item;
}

async function send(item) {
  const response = await fetch(item.endpoint, {
    method: item.method,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...item.headers },
    body: item.body == null ? undefined : JSON.stringify(item.body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message ?? `Sync failed with HTTP ${response.status}`;
    const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
    const error = new Error(message);
    error.retryable = retryable;
    throw error;
  }
  return payload;
}

export async function flushOfflineQueue() {
  if (!navigator.onLine) return { synced: 0, pending: await pendingOutboxCount() };
  let synced = 0;
  const items = (await listOutbox()).filter((item) => item.status === "pending");
  for (const item of items) {
    await updateOutbox(item.id, { status: "syncing", attempts: item.attempts + 1 });
    try {
      await send(item);
      await removeOutbox(item.id);
      synced += 1;
    } catch (error) {
      await updateOutbox(item.id, {
        status: error.retryable ? "pending" : "failed",
        lastError: error instanceof Error ? error.message : "Unknown synchronization error",
      });
    }
  }
  notify();
  return { synced, pending: await pendingOutboxCount() };
}

export async function getOfflineState() {
  return {
    online: navigator.onLine,
    pending: await pendingOutboxCount(),
  };
}

window.addEventListener("online", () => void flushOfflineQueue());
window.addEventListener("online", notify);
window.addEventListener("offline", notify);

const DB_NAME = "muraderp-ai-offline";
const DB_VERSION = 1;
const STORE = "outbox";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("status", "status");
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open offline storage."));
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline storage operation failed."));
  });
}

export async function enqueueOutbox({ endpoint, method = "POST", headers = {}, body, kind = "erp-draft" }) {
  const db = await openDb();
  const item = {
    id: crypto.randomUUID(),
    kind,
    endpoint,
    method,
    headers,
    body,
    status: "pending",
    attempts: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastError: null,
  };
  await requestToPromise(db.transaction(STORE, "readwrite").objectStore(STORE).add(item));
  db.close();
  return item;
}

export async function listOutbox() {
  const db = await openDb();
  const items = await requestToPromise(db.transaction(STORE, "readonly").objectStore(STORE).index("createdAt").getAll());
  db.close();
  return items;
}

export async function updateOutbox(id, patch) {
  const db = await openDb();
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  const item = await requestToPromise(store.get(id));
  if (!item) return null;
  const next = { ...item, ...patch, updatedAt: new Date().toISOString() };
  await requestToPromise(store.put(next));
  db.close();
  return next;
}

export async function removeOutbox(id) {
  const db = await openDb();
  await requestToPromise(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
  db.close();
}

export async function pendingOutboxCount() {
  const db = await openDb();
  const count = await requestToPromise(db.transaction(STORE, "readonly").objectStore(STORE).index("status").count("pending"));
  db.close();
  return count;
}

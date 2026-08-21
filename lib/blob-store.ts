// Namespaced binary storage on IndexedDB.
//
// `lib/history.ts` is the app's text persistence layer and stays that way —
// `localStorage` holds a few kilobytes of JSON and cannot hold audio. This is
// the second storage layer, and it is deliberately *general*: Story 1.4 uses
// the `"tts"` namespace for native sample audio, and Epic 2 will use another
// one for the learner's own recordings. Building it namespaced now, while the
// only caller is one namespace, is cheaper than retrofitting it later.
//
// Keys are supplied by the caller and are expected to be content-derived (see
// `lib/sample-audio.ts`), so a `put` of the same content is idempotent.
//
// Everything here touches IndexedDB, which the node test environment does not
// have. That is why the decision logic lives in `lib/sample-audio.ts` instead:
// this module is the thin, hand-verified wrapper.

const DB_NAME = "ankichat_blobs";
const DB_VERSION = 1;
const STORE_NAME = "blobs";
const NAMESPACE_INDEX = "by_namespace";

export interface BlobRecord {
  /** `${namespace}:${key}` — the object store's key path. */
  id: string;
  namespace: string;
  key: string;
  blob: Blob;
  createdAt: string;
}

/** Composite primary key. One flat store, partitioned by the id prefix. */
export function blobId(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;
/** The resolved connection, so the lifecycle handlers can tell whether the
 *  cache still points at *them* before clearing it. */
let cachedDb: IDBDatabase | null = null;

function forgetDb() {
  dbPromise = null;
  cachedDb = null;
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB không khả dụng trong môi trường này"));
  }
  // Cached: reopening per call would serialise every read behind a fresh
  // connection handshake, and the whole point of this layer is that a reopened
  // script reads its audio back without a visible wait.
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex(NAMESPACE_INDEX, "namespace", { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // A cached connection has to be able to *recover*, not only to fail to
        // open. Another tab upgrading the schema fires `versionchange` here;
        // holding the connection open blocks that tab indefinitely, and every
        // later transaction on this one throws `InvalidStateError` — which the
        // user would be shown as a generic "could not save" for the whole life
        // of the page. Close, forget the cache, reopen on the next call.
        db.onversionchange = () => {
          db.close();
          if (cachedDb === db) forgetDb();
        };
        db.onclose = () => {
          if (cachedDb === db) forgetDb();
        };
        cachedDb = db;
        resolve(db);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Không mở được IndexedDB"));
      request.onblocked = () =>
        reject(new Error("IndexedDB đang bị một tab khác giữ"));
    }).catch((err) => {
      // A failed open must not poison every later call either.
      forgetDb();
      throw err;
    });
  }
  return dbPromise;
}

/**
 * Run `work` in one transaction and settle on the *transaction*, not on the
 * requests inside it.
 *
 * A `QuotaExceededError` on a write surfaces on the transaction's `abort` and
 * not reliably on the request, and "storage is full" is the one failure this
 * story has to report accurately. Settling on `oncomplete` also means a `put`
 * has really been committed before the caller is told the blob is stored.
 */
async function runTransaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => () => T
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const fail = () => reject(tx.error ?? new Error("Thao tác IndexedDB thất bại"));
    tx.onabort = fail;
    tx.onerror = fail;
    try {
      const read = work(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(read());
    } catch (err) {
      reject(err);
    }
  });
}

/** The common case: one request, whose `result` is the answer. */
function requested<T>(request: IDBRequest<T>): () => T {
  return () => request.result;
}

/** Store `blob`, replacing whatever sat under the same namespace + key. */
export async function putBlob(
  namespace: string,
  key: string,
  blob: Blob
): Promise<void> {
  const record: BlobRecord = {
    id: blobId(namespace, key),
    namespace,
    key,
    blob,
    createdAt: new Date().toISOString(),
  };
  await runTransaction("readwrite", (store) => requested(store.put(record)));
}

export async function getBlob(
  namespace: string,
  key: string
): Promise<Blob | undefined> {
  const record = await runTransaction("readonly", (store) =>
    requested<BlobRecord | undefined>(store.get(blobId(namespace, key)))
  );
  return record?.blob;
}

/**
 * Is this key already stored?
 *
 * Counts rather than reads: the caller only wants to know whether a fetch is
 * needed, and deserialising megabytes of audio to answer that would make the
 * "reopening makes no request" path slower than the request it replaces.
 */
export async function hasBlob(namespace: string, key: string): Promise<boolean> {
  const count = await runTransaction("readonly", (store) =>
    requested<number>(store.count(blobId(namespace, key)))
  );
  return count > 0;
}

/** Drop one blob. */
export async function deleteBlob(namespace: string, key: string): Promise<void> {
  await runTransaction("readwrite", (store) =>
    requested(store.delete(blobId(namespace, key)))
  );
}

/** Drop every blob in one namespace, leaving the others alone. */
export async function deleteNamespace(namespace: string): Promise<void> {
  await runTransaction("readwrite", (store) => {
    const cursorRequest = store
      .index(NAMESPACE_INDEX)
      .openCursor(IDBKeyRange.only(namespace));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    return () => undefined;
  });
}

/**
 * A key/value view of one namespace.
 *
 * This is the shape `lib/sample-audio.ts` is written against, so its logic can
 * be driven by an in-memory fake in the node test environment while the real
 * app passes this.
 */
export interface NamespacedBlobStore {
  has(key: string): Promise<boolean>;
  get(key: string): Promise<Blob | undefined>;
  put(key: string, blob: Blob): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export function namespacedBlobStore(namespace: string): NamespacedBlobStore {
  return {
    has: (key) => hasBlob(namespace, key),
    get: (key) => getBlob(namespace, key),
    put: (key, blob) => putBlob(namespace, key, blob),
    delete: (key) => deleteBlob(namespace, key),
    clear: () => deleteNamespace(namespace),
  };
}

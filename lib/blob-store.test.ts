import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blobId, deleteBlob, getBlob, hasBlob, putBlob } from "./blob-store";

/**
 * The node test environment has no IndexedDB, and adding `fake-indexeddb` is
 * an Ask First dependency, so this is **not** a test of IndexedDB semantics —
 * transactions, quota, cursors and durability are all still verified by hand.
 *
 * What it *is* is a recorder: a stub that answers `open`/`transaction` and
 * writes down which primary key each operation used. That pins the one thing
 * about this module a reader cannot check by inspection and that fails
 * silently in production — read/write key symmetry. Drop the namespace from
 * one side and `hasBlob` returns false forever: every reopened script looks
 * uncached and quietly re-bills Azure for audio that is already on disk, with
 * nothing anywhere going red.
 */

interface Operation {
  name: string;
  key?: unknown;
}

let operations: Operation[] = [];
/** Whatever the next `get` should resolve with. */
let stored: unknown;

function fakeRequest<T>(result: T) {
  const request = { result, onsuccess: null as null | (() => void) };
  queueMicrotask(() => request.onsuccess?.());
  return request;
}

function installRecorder() {
  const objectStore = {
    put(record: { id: string }) {
      operations.push({ name: "put", key: record.id });
      return fakeRequest(undefined);
    },
    get(key: unknown) {
      operations.push({ name: "get", key });
      return fakeRequest(stored);
    },
    count(key: unknown) {
      operations.push({ name: "count", key });
      return fakeRequest(stored === undefined ? 0 : 1);
    },
    delete(key: unknown) {
      operations.push({ name: "delete", key });
      return fakeRequest(undefined);
    },
    index() {
      return {
        openCursor: () => fakeRequest(null),
      };
    },
  };

  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => objectStore,
    transaction() {
      const tx = {
        objectStore: () => objectStore,
        error: null,
        oncomplete: null as null | (() => void),
        onabort: null,
        onerror: null,
      };
      // After the operation has been recorded in the same turn.
      queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()));
      return tx;
    },
    close() {},
    onversionchange: null,
    onclose: null,
  };

  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open: () => fakeRequest(db),
  };
}

beforeEach(() => {
  operations = [];
  stored = undefined;
  installRecorder();
});

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe("blobId", () => {
  it("composes namespace and key", () => {
    expect(blobId("tts", "abc")).toBe("tts:abc");
  });

  it("keeps two namespaces apart under the same key", () => {
    // Epic 2 stores learner recordings beside these; a shared primary key
    // would have one overwrite the other.
    expect(blobId("tts", "abc")).not.toBe(blobId("recordings", "abc"));
  });
});

describe("read/write key symmetry", () => {
  it("writes under blobId", async () => {
    await putBlob("tts", "abc", new Blob(["audio"]));

    expect(operations).toEqual([{ name: "put", key: blobId("tts", "abc") }]);
  });

  it("reads back under the same key it wrote", async () => {
    stored = { blob: new Blob(["audio"]) };

    await getBlob("tts", "abc");

    expect(operations).toEqual([{ name: "get", key: blobId("tts", "abc") }]);
  });

  it("counts under the same key — this is the one that re-bills Azure", async () => {
    await hasBlob("tts", "abc");

    expect(operations).toEqual([{ name: "count", key: blobId("tts", "abc") }]);
  });

  it("deletes under the same key", async () => {
    await deleteBlob("tts", "abc");

    expect(operations).toEqual([{ name: "delete", key: blobId("tts", "abc") }]);
  });

  it("agrees across all four operations", async () => {
    await putBlob("tts", "abc", new Blob(["audio"]));
    stored = { blob: new Blob(["audio"]) };
    await getBlob("tts", "abc");
    await hasBlob("tts", "abc");
    await deleteBlob("tts", "abc");

    expect(new Set(operations.map((op) => op.key)).size).toBe(1);
  });
});

describe("hasBlob", () => {
  it("is false for a key nothing was written under", async () => {
    expect(await hasBlob("tts", "missing")).toBe(false);
  });

  it("is true once the store counts a row", async () => {
    stored = { blob: new Blob(["audio"]) };

    expect(await hasBlob("tts", "abc")).toBe(true);
  });
});

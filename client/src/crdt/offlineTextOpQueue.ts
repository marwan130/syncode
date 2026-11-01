/**
 * IndexedDB-backed queue for text CRDT operations that were generated while
 * the client was offline. Operations are stored with a stable `opId` so
 * replaying them on reconnect is idempotent — the server can ignore duplicates.
 */

import type { CrdtOp } from './CrdtDocument';

export interface QueuedTextOp {
  /** globally unique: roomId + fileId + opId */
  key: string;
  roomId: string;
  fileId: string;
  /** counter is the position within the file queue, used for ordered replay */
  seq: number;
  op: CrdtOp;
}

const DB_NAME = 'syncode-offline-text-ops';
const STORE = 'ops';
let dbPromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined')
    return Promise.reject(new Error('IndexedDB is unavailable.'));
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore(STORE, { keyPath: 'key' });
      store.createIndex('roomId', 'roomId', { unique: false });
      store.createIndex('fileId', ['roomId', 'fileId'], { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => {
    dbPromise = undefined;
  });
  return dbPromise;
}

function makeKey(roomId: string, fileId: string, seq: number): string {
  // zero-pad seq so lexicographic sort preserves insertion order
  return `${roomId}:${fileId}:${String(seq).padStart(12, '0')}`;
}

/** Append a single op to the offline queue. Returns the assigned seq number. */
export async function queueOfflineTextOp(
  roomId: string,
  fileId: string,
  op: CrdtOp,
  seq: number
): Promise<void> {
  const db = await openDatabase();
  const record: QueuedTextOp = {
    key: makeKey(roomId, fileId, seq),
    roomId,
    fileId,
    seq,
    op,
  };
  await new Promise<void>((resolve, reject) => {
    const req = db
      .transaction(STORE, 'readwrite')
      .objectStore(STORE)
      .put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Return all queued ops for a room, ordered by file then seq. */
export async function listOfflineTextOps(
  roomId: string
): Promise<QueuedTextOp[]> {
  const db = await openDatabase();
  return new Promise<QueuedTextOp[]>((resolve, reject) => {
    const req = db
      .transaction(STORE, 'readonly')
      .objectStore(STORE)
      .index('roomId')
      .getAll(IDBKeyRange.only(roomId));
    req.onsuccess = () => {
      const records = (req.result as QueuedTextOp[]).slice().sort((a, b) => {
        if (a.fileId !== b.fileId) return a.fileId < b.fileId ? -1 : 1;
        return a.seq - b.seq;
      });
      resolve(records);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Remove a specific op by key after it has been successfully replayed. */
export async function removeOfflineTextOp(key: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const req = db
      .transaction(STORE, 'readwrite')
      .objectStore(STORE)
      .delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Remove every queued op for a room (called after successful replay). */
export async function clearOfflineTextOps(roomId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.index('roomId').openKeyCursor(IDBKeyRange.only(roomId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

import { ProjectTree } from './ProjectTree';
import type { ProjectTreeOperation } from './ProjectTree';

interface PendingOperationRecord {
  key: string;
  roomId: string;
  operation: ProjectTreeOperation;
}

const databaseName = 'syncode-project-tree';
const storeName = 'pending-operations';
let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined')
    return Promise.reject(new Error('IndexedDB is unavailable.'));
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.createObjectStore(storeName, { keyPath: 'key' });
      store.createIndex('roomId', 'roomId', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  databasePromise.catch(() => {
    databasePromise = undefined;
  });
  return databasePromise;
}

function operationKey(operation: ProjectTreeOperation): string {
  return `${operation.opId.siteId}:${operation.opId.counter}`;
}

export async function listPendingProjectTreeOperations(
  roomId: string
): Promise<ProjectTreeOperation[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(storeName, 'readonly')
      .objectStore(storeName)
      .index('roomId')
      .getAll(roomId);
    request.onsuccess = () => {
      const records = request.result as PendingOperationRecord[];
      resolve(
        records
          .map(({ operation }) => operation)
          .sort((left, right) => {
            if (left.opId.siteId !== right.opId.siteId)
              return left.opId.siteId < right.opId.siteId ? -1 : 1;
            return left.opId.counter - right.opId.counter;
          })
      );
    };
    request.onerror = () => reject(request.error);
  });
}

export async function savePendingProjectTreeOperation(
  roomId: string,
  operation: ProjectTreeOperation
): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database
      .transaction(storeName, 'readwrite')
      .objectStore(storeName)
      .put({
        key: `${roomId}:${operationKey(operation)}`,
        roomId,
        operation,
      } satisfies PendingOperationRecord);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function removePendingProjectTreeOperation(
  roomId: string,
  operation: ProjectTreeOperation
): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database
      .transaction(storeName, 'readwrite')
      .objectStore(storeName)
      .delete(`${roomId}:${operationKey(operation)}`);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearPendingProjectTreeOperations(
  roomId: string
): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store
      .index('roomId')
      .openKeyCursor(IDBKeyRange.only(roomId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function migratePendingProjectTreeOperations(
  roomId: string,
  legacyStorageKey: string
): Promise<void> {
  const legacy = readLegacyOperations(legacyStorageKey);
  if (legacy.length === 0) return;
  const valid = validatePendingProjectTreeOperations(legacy);
  await Promise.all(
    valid.map((operation) => savePendingProjectTreeOperation(roomId, operation))
  );
  clearLegacyOperations(legacyStorageKey);
}

function readLegacyOperations(key: string): unknown[] {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    clearLegacyOperations(key);
    return [];
  }
}

function clearLegacyOperations(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    return;
  }
}

export function validatePendingProjectTreeOperations(
  operations: unknown[]
): ProjectTreeOperation[] {
  const tree = new ProjectTree('pending-outbox-validation');
  const valid: ProjectTreeOperation[] = [];
  for (const operation of operations) {
    try {
      tree.applyOperation(operation as ProjectTreeOperation);
      valid.push(operation as ProjectTreeOperation);
    } catch {
      continue;
    }
  }
  return valid;
}

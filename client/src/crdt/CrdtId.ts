export interface CrdtId {
  siteId: string;
  counter: number; // logical lamport clock
}

/**
 * handles situations when two users type at the exact same spot at the same time.
 * creates a deterministic order to ensure consistency across all clients without the need for a central server/coordinator
 * by comparing site ids when counters are equal, which is a core rule of RGA.
 */
export function compareCrdtIds(a: CrdtId, b: CrdtId): number {
  if (a.counter !== b.counter) {
    return a.counter - b.counter;
  }

  if (a.siteId < b.siteId) return -1;
  if (a.siteId > b.siteId) return 1;
  return 0;
}

/**
 * in javascript, objects are compared by reference, not value, so if we use "===" to compare two objects
 * that have the same id and counter, it might return false because they are different objects.
 */
export function crdtIdsEqual(a: CrdtId | null, b: CrdtId | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.counter === b.counter && a.siteId === b.siteId;
}

/**
 * useful for maps and the pending buffer because object keys are compared by reference not value
 */
export function crdtIdToString(id: CrdtId | null): string {
  if (id === null) return 'ROOT';
  return `${id.siteId}:${id.counter}`;
}

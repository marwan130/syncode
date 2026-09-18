import type { CrdtId } from './CrdtId';
import { compareCrdtIds, crdtIdsEqual } from './CrdtId';
import type { CrdtChar } from './CrdtChar';
import { createChar } from './CrdtChar';

export interface InsertOp {
  type: 'insert';
  char: CrdtChar;
}

export interface DeleteOp {
  type: 'delete';
  id: CrdtId;
}

export type CrdtOp = InsertOp | DeleteOp;

export interface CrdtSnapshot {
  clock: number;
  chars: CrdtChar[];
}

/**
 * RGA (Replicated Growable Array) sequence CRDT implementation.
 * each client maintains their own document and only broadcasts small insert/delete operations.
 * the integration rules guarantee all replicas converge to the exact same character sequence
 * regardless of the order operations arrive in.
 *
 * - lamport timestamps (siteId + counter) give every character a globally unique, immutable id
 * - tombstones preserve deleted characters so concurrent inserts that reference them stay valid
 * - compareCrdtIds resolves concurrent inserts at the same position deterministically
 *
 * tombstones are never garbage-collected in this implementation as tombstone growth is bounded by the room's lifetime.
 */
export class CrdtDocument {
  public readonly siteId: string;
  public clock: number;
  public chars: CrdtChar[];

  constructor(siteId: string) {
    this.siteId = siteId;
    this.clock = 0;
    this.chars = [];
  }

  private findCharIndex(id: CrdtId): number {
    for (let i = 0; i < this.chars.length; i++) {
      if (crdtIdsEqual(this.chars[i].id, id)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * needed for the pending buffer because in distributed real-time systems, packets can arrive out of order.
   * insert operations must wait for their origin character to be visible in the document
   */
  public hasChar(id: CrdtId): boolean {
    return this.findCharIndex(id) !== -1;
  }

  /**
   * rga integration rule: scans forward from the origin position,
   * skipping any sibling characters with a higher id, and inserts
   * the new character at the first position where it should come first.
   * every replica applying this rule to the same set of operations
   * in any order will produce the identical sequence.
   *
   * two cases during the scan:
   * 1. direct sibling (same originId): use compareCrdtIds to decide order
   * 2. not a sibling: call findCharIndex to check whether we have walked past our origin's subtree
   */
  private insertChar(newChar: CrdtChar): void {
    const originPos =
      newChar.originId === null ? -1 : this.findCharIndex(newChar.originId);

    let insertPos = originPos + 1;

    while (insertPos < this.chars.length) {
      const next = this.chars[insertPos];

      if (crdtIdsEqual(next.originId, newChar.originId)) {
        // direct sibling, meaning both were inserted after the same character
        // rga rule: higher id comes first
        if (compareCrdtIds(newChar.id, next.id) > 0) {
          break;
        }
      } else {
        // If the next character was created before our origin, we have reached the end of our section and should insert here
        const nextOriginPos =
          next.originId === null ? -1 : this.findCharIndex(next.originId);
        if (nextOriginPos < originPos) {
          break;
        }
      }

      insertPos++;
    }

    this.chars.splice(insertPos, 0, newChar);
  }

  public localInsert(originId: CrdtId | null, value: string): InsertOp {
    this.clock += 1;
    const id: CrdtId = { siteId: this.siteId, counter: this.clock };
    const char = createChar(id, value, originId);

    this.insertChar(char);

    return {
      type: 'insert',
      char,
    };
  }

  public localDelete(id: CrdtId): DeleteOp {
    const index = this.findCharIndex(id);
    if (index !== -1) {
      this.chars[index].isDeleted = true;
    }

    return {
      type: 'delete',
      id,
    };
  }

  public integrateRemoteInsert(op: InsertOp): void {
    this.clock = Math.max(this.clock, op.char.id.counter);

    // prevents duplicate characters if the network delivers the same operation twice
    if (this.findCharIndex(op.char.id) !== -1) {
      return;
    }

    this.insertChar(op.char);
  }

  public integrateRemoteDelete(op: DeleteOp): void {
    const index = this.findCharIndex(op.id);
    if (index !== -1) {
      this.chars[index].isDeleted = true;
    }
  }

  public toVisibleString(): string {
    return this.chars
      .filter((c) => !c.isDeleted)
      .map((c) => c.value)
      .join('');
  }

  public toSnapshot(): string {
    const snapshot: CrdtSnapshot = {
      clock: this.clock,
      chars: this.chars,
    };
    return JSON.stringify(snapshot);
  }

  public fromSnapshot(snapshotJson: string): void {
    const snapshot: CrdtSnapshot = JSON.parse(snapshotJson);
    this.clock = snapshot.clock;
    this.chars = snapshot.chars;
  }
}

import { crdtIdToString } from './CrdtId';
import type { CrdtDocument, InsertOp, DeleteOp, CrdtOp } from './CrdtDocument';

/**
 * buffers remote operations until missing causal dependencies arrive
 *
 * signalR does not guarantee global causal ordering across sites.
 * if a site sends an insert with originId = x, before another replica receives x,
 * integrating that operation immediately would place the character at the wrong position.
 *
 * we solve the problem by checking if an insert's originId exists in the document before integrating,
 * if it's missing, hold the op in pendingInserts using originID as the key, when a new character is integrated,
 * drain any inserts that were waiting on it and cascade unblocked operations.
 *
 * deletes that arrive before the intended character is inserted are held in
 * pendingDeletes and applied the moment the character is added to the document.
 *
 * this solution guarantees that every operation is eventually integrated in causal order,
 * regardless of network delivery order.
 */
export class PendingBuffer {
  private doc: CrdtDocument;

  // the value is an array of operations because multiple ops can share the same originID
  private pendingInserts: Map<string, InsertOp[]>;
  private pendingDeletes: Map<string, DeleteOp[]>;

  constructor(doc: CrdtDocument) {
    this.doc = doc;
    this.pendingInserts = new Map();
    this.pendingDeletes = new Map();
  }

  public process(op: CrdtOp): void {
    if (op.type === 'insert') {
      this.processInsert(op);
    } else {
      this.processDelete(op);
    }
  }

  public get size(): number {
    let total = 0;
    for (const ops of this.pendingInserts.values()) total += ops.length;
    for (const ops of this.pendingDeletes.values()) total += ops.length;
    return total;
  }

  private isInsertReady(op: InsertOp): boolean {
    if (op.char.originId === null) return true;
    return this.doc.hasChar(op.char.originId);
  }

  private processInsert(op: InsertOp): void {
    if (!this.isInsertReady(op)) {
      const key = crdtIdToString(op.char.originId);
      if (!this.pendingInserts.has(key)) {
        this.pendingInserts.set(key, []);
      }
      this.pendingInserts.get(key)!.push(op);
      return;
    }

    this.doc.integrateRemoteInsert(op);
    this.drain(op.char.id);
  }

  private processDelete(op: DeleteOp): void {
    if (!this.doc.hasChar(op.id)) {
      const key = crdtIdToString(op.id);
      if (!this.pendingDeletes.has(key)) {
        this.pendingDeletes.set(key, []);
      }
      this.pendingDeletes.get(key)!.push(op);
      return;
    }

    this.doc.integrateRemoteDelete(op);
  }

  /**
   * after a character with the given id is integrated, check whether any
   * buffered operations were waiting on it and integrate those too.
   */
  private drain(id: Parameters<typeof crdtIdToString>[0]): void {
    const key = crdtIdToString(id);

    const pendingDels = this.pendingDeletes.get(key);
    if (pendingDels) {
      this.pendingDeletes.delete(key);
      for (const del of pendingDels) {
        this.doc.integrateRemoteDelete(del);
      }
    }

    const pendingIns = this.pendingInserts.get(key);
    if (pendingIns) {
      this.pendingInserts.delete(key);
      for (const ins of pendingIns) {
        this.doc.integrateRemoteInsert(ins);
        this.drain(ins.char.id);
      }
    }
  }
}

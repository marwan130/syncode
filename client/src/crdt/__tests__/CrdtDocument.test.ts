import { describe, it, expect } from 'vitest';
import { CrdtDocument } from '../CrdtDocument';
import type { CrdtOp } from '../CrdtDocument';
import type { CrdtId } from '../CrdtId';
import { PendingBuffer } from '../PendingBuffer';

describe('CrdtDocument (RGA)', () => {
  it('handles basic sequential local insertions and deletions', () => {
    const doc = new CrdtDocument('site-1');

    const op1 = doc.localInsert(null, 'a');
    const op2 = doc.localInsert(op1.char.id, 'b');
    doc.localInsert(op2.char.id, 'c');

    expect(doc.toVisibleString()).toBe('abc');

    doc.localDelete(op2.char.id);
    expect(doc.toVisibleString()).toBe('ac');
  });

  it('converges when two sites insert concurrently at the same origin', () => {
    const docA = new CrdtDocument('site-A');
    const docB = new CrdtDocument('site-B');

    const opA = docA.localInsert(null, 'A');
    const opB = docB.localInsert(null, 'B');

    docA.integrateRemoteInsert(opB);

    docB.integrateRemoteInsert(opA);

    expect(docA.toVisibleString()).toBe(docB.toVisibleString());
  });

  it('converges regardless of operation delivery order', () => {
    const docA = new CrdtDocument('site-A');
    const docB = new CrdtDocument('site-B');

    const op1 = docA.localInsert(null, 'c');
    const op2 = docA.localInsert(op1.char.id, 'a');
    const op3 = docA.localInsert(op2.char.id, 't');

    docB.integrateRemoteInsert(op1);
    docB.integrateRemoteInsert(op2);
    docB.integrateRemoteInsert(op3);

    expect(docA.toVisibleString()).toBe('cat');
    expect(docB.toVisibleString()).toBe('cat');

    const opA = docA.localInsert(op3.char.id, 's');

    const opB = docB.localInsert(op3.char.id, '!');

    docA.integrateRemoteInsert(opB);
    docB.integrateRemoteInsert(opA);

    expect(docA.toVisibleString()).toBe(docB.toVisibleString());
  });

  it('preserves concurrent insert when target origin character was deleted', () => {
    const docA = new CrdtDocument('site-A');
    const docB = new CrdtDocument('site-B');

    const opH = docA.localInsert(null, 'h');
    const opI = docA.localInsert(opH.char.id, 'i');

    docB.integrateRemoteInsert(opH);
    docB.integrateRemoteInsert(opI);

    const delI = docA.localDelete(opI.char.id);

    const opExcl = docB.localInsert(opI.char.id, '!');

    docA.integrateRemoteInsert(opExcl);
    docB.integrateRemoteDelete(delI);

    expect(docA.toVisibleString()).toBe('h!');
    expect(docB.toVisibleString()).toBe('h!');
    expect(docA.toVisibleString()).toBe(docB.toVisibleString());
  });

  it('is idempotent on duplicate deliveries of inserts and deletes', () => {
    const docA = new CrdtDocument('site-A');
    const docB = new CrdtDocument('site-B');

    const op = docA.localInsert(null, 'x');

    docB.integrateRemoteInsert(op);
    docB.integrateRemoteInsert(op);

    expect(docB.toVisibleString()).toBe('x');

    const del = docA.localDelete(op.char.id);
    docB.integrateRemoteDelete(del);
    docB.integrateRemoteDelete(del);

    expect(docB.toVisibleString()).toBe('');
  });

  it('correctly serializes to and restores from snapshots', () => {
    const doc = new CrdtDocument('site-1');
    const op1 = doc.localInsert(null, 'x');
    doc.localInsert(op1.char.id, 'y');
    doc.localDelete(op1.char.id);

    const snapshot = doc.toSnapshot();

    const restoredDoc = new CrdtDocument('site-2');
    restoredDoc.fromSnapshot(snapshot);

    expect(restoredDoc.toVisibleString()).toBe('y');
    expect(restoredDoc.chars.length).toBe(2);
    expect(restoredDoc.chars[0].isDeleted).toBe(true);
    expect(restoredDoc.chars[1].isDeleted).toBe(false);
  });

  it('builds imported text with the same CRDT state without repeated insertion scans', () => {
    const inserted = new CrdtDocument('site-1');
    let originId: CrdtId | null = null;
    for (const character of 'fast import') {
      const operation = inserted.localInsert(originId, character);
      originId = operation.char.id;
    }

    const imported = CrdtDocument.fromText('site-1', 'fast import');
    expect(imported.toSnapshot()).toBe(inserted.toSnapshot());
  });

  it('places a child immediately after its parent even when the parent lost a sibling tiebreak', () => {
    const docA = new CrdtDocument('site-A');
    const docB = new CrdtDocument('site-B');

    const opA = docA.localInsert(null, 'a');
    const opB = docB.localInsert(null, 'b');

    docA.integrateRemoteInsert(opB);
    docB.integrateRemoteInsert(opA);

    expect(docA.toVisibleString()).toBe(docB.toVisibleString());

    const opChild = docA.localInsert(opA.char.id, 'c');

    docB.integrateRemoteInsert(opChild);

    expect(docA.toVisibleString()).toBe('bac');
    expect(docB.toVisibleString()).toBe('bac');
  });

  it('allows a late-joining replica to restore from snapshot and integrate a straggling op referencing a tombstone', () => {
    const docA = new CrdtDocument('site-A');
    const docB = new CrdtDocument('site-B');

    const opH = docA.localInsert(null, 'h');
    const opE = docA.localInsert(opH.char.id, 'e');
    const opL = docA.localInsert(opE.char.id, 'l');
    docB.integrateRemoteInsert(opH);
    docB.integrateRemoteInsert(opE);
    docB.integrateRemoteInsert(opL);

    const delL = docA.localDelete(opL.char.id);
    docB.integrateRemoteDelete(delL);

    const opP = docB.localInsert(opL.char.id, 'p');

    const snapshotA = docA.toSnapshot();
    const docC = new CrdtDocument('site-C');
    docC.fromSnapshot(snapshotA);

    expect(docC.toVisibleString()).toBe('he');

    docC.integrateRemoteInsert(opP);
    docA.integrateRemoteInsert(opP);

    expect(docC.toVisibleString()).toBe('hep');
    expect(docA.toVisibleString()).toBe('hep');
    expect(docB.toVisibleString()).toBe('hep');
  });

  it('guarantees convergence across 3+ sites with randomized operation interleavings (fuzz test)', () => {
    for (let seed = 1; seed <= 25; seed++) assertSeedConverges(seed);
  });
});

function assertSeedConverges(seed: number): void {
  const peers = ['site-A', 'site-B', 'site-C'].map((siteId) => ({
    siteId,
    document: new CrdtDocument(siteId),
  }));
  const buffers = peers.map(({ document }) => new PendingBuffer(document));
  const operations = createInitialOperations(peers);
  peers.forEach((peer, index) => {
    const order = shuffleOperations(operations, seed + index);
    deliverRemoteOperations(buffers[index], order, peer.siteId);
  });

  buffers.forEach((buffer) => expect(buffer.size).toBe(0));
  const visibleText = peers.map(({ document }) => document.toVisibleString());
  expect(new Set(visibleText).size).toBe(1);
}

function createInitialOperations(
  peers: Array<{ siteId: string; document: CrdtDocument }>
): CrdtOp[] {
  return peers.flatMap(({ document, siteId }) => {
    const first = document.localInsert(null, siteId.slice(-1));
    const second = document.localInsert(
      first.char.id,
      siteId.slice(-1).toLowerCase()
    );
    return [first, second];
  });
}

function createRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

function shuffleOperations<T>(items: T[], seed: number): T[] {
  const nextRandom = createRandom(seed);
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(nextRandom() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}

function deliverRemoteOperations(
  buffer: PendingBuffer,
  operations: CrdtOp[],
  localSiteId: string
): void {
  for (const operation of operations) {
    const operationSiteId =
      operation.type === 'insert'
        ? operation.char.id.siteId
        : operation.id.siteId;
    if (operationSiteId !== localSiteId) buffer.process(operation);
  }
}

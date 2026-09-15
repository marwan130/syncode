import { describe, it, expect } from 'vitest';
import { CrdtDocument } from '../CrdtDocument';

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
});

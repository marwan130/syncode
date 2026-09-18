import { describe, it, expect } from 'vitest';
import { CrdtDocument } from '../CrdtDocument';
import { PendingBuffer } from '../PendingBuffer';

function buildChain(text: string): {
  ops: ReturnType<CrdtDocument['localInsert']>[];
  src: CrdtDocument;
} {
  const src = new CrdtDocument('src');
  const ops: ReturnType<CrdtDocument['localInsert']>[] = [];
  let prevId = null;
  for (const ch of text) {
    const op = src.localInsert(prevId, ch);
    ops.push(op);
    prevId = op.char.id;
  }
  return { ops, src };
}

describe('PendingBuffer', () => {
  it('integrates inserts immediately when they are causally ready (no buffering needed)', () => {
    const doc = new CrdtDocument('site-recv');
    const buf = new PendingBuffer(doc);

    const { ops } = buildChain('hello');

    for (const op of ops) {
      buf.process(op);
    }

    expect(doc.toVisibleString()).toBe('hello');
    expect(buf.size).toBe(0);
  });

  it('buffers and eventually integrates inserts delivered in reverse order', () => {
    const doc = new CrdtDocument('site-recv');
    const buf = new PendingBuffer(doc);

    const { ops } = buildChain('abc');

    for (let i = ops.length - 1; i >= 0; i--) {
      buf.process(ops[i]);
    }

    expect(doc.toVisibleString()).toBe('abc');
    expect(buf.size).toBe(0);
  });

  it('buffers and eventually integrates inserts delivered in a random shuffled order', () => {
    const doc = new CrdtDocument('site-recv');
    const buf = new PendingBuffer(doc);

    const { ops } = buildChain('syncode');

    const shuffled = [...ops];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (i * 3 + 1) % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    for (const op of shuffled) {
      buf.process(op);
    }

    expect(doc.toVisibleString()).toBe('syncode');
    expect(buf.size).toBe(0);
  });

  it('handles a cascading dependency chain (A?B?C?D all buffered until A arrives)', () => {
    const doc = new CrdtDocument('site-recv');
    const buf = new PendingBuffer(doc);

    const { ops } = buildChain('wxyz');
    const [opW, opX, opY, opZ] = ops;

    buf.process(opZ);
    buf.process(opY);
    buf.process(opX);
    expect(buf.size).toBe(3);

    buf.process(opW);
    expect(doc.toVisibleString()).toBe('wxyz');
    expect(buf.size).toBe(0);
  });

  it('applies a buffered delete the moment its target character arrives', () => {
    const doc = new CrdtDocument('site-recv');
    const buf = new PendingBuffer(doc);

    const src = new CrdtDocument('src');
    const insertOp = src.localInsert(null, 'x');
    const deleteOp = src.localDelete(insertOp.char.id);

    buf.process(deleteOp);
    expect(buf.size).toBe(1);
    expect(doc.toVisibleString()).toBe('');

    buf.process(insertOp);
    expect(doc.toVisibleString()).toBe('');
    expect(buf.size).toBe(0);
  });

  it('is idempotent on duplicate deliveries of the same insert', () => {
    const doc = new CrdtDocument('site-recv');
    const buf = new PendingBuffer(doc);

    const { ops } = buildChain('hi');
    const [opH, opI] = ops;

    buf.process(opH);
    buf.process(opH);
    buf.process(opI);
    buf.process(opI);

    expect(doc.toVisibleString()).toBe('hi');
    expect(buf.size).toBe(0);
  });

  it('converges with concurrent inserts across two sites, both using a PendingBuffer', () => {
    const docA = new CrdtDocument('site-A');
    const docB = new CrdtDocument('site-B');
    const bufA = new PendingBuffer(docA);
    const bufB = new PendingBuffer(docB);

    const opA1 = docA.localInsert(null, 'a');
    const opA2 = docA.localInsert(opA1.char.id, 'b');

    const opB1 = docB.localInsert(null, 'c');
    const opB2 = docB.localInsert(opB1.char.id, 'd');

    bufA.process(opB2);
    bufA.process(opB1);

    bufB.process(opA2);
    bufB.process(opA1);

    expect(docA.toVisibleString()).toBe(docB.toVisibleString());
    expect(bufA.size).toBe(0);
    expect(bufB.size).toBe(0);
  });
});

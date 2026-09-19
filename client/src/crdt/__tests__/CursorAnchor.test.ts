import { describe, it, expect } from 'vitest';
import { CrdtDocument } from '../CrdtDocument';
import {
  createCursorAnchor,
  createCursorAnchorFromPosition,
  resolveCursorAnchor,
  createSelectionAnchor,
  resolveSelectionAnchor,
} from '../CursorAnchor';

describe('CursorAnchor', () => {
  it('resolves null anchor to the start of the document', () => {
    const doc = new CrdtDocument('site-1');
    const anchor = createCursorAnchor(doc, 0);

    expect(anchor.afterId).toBeNull();

    const resolved = resolveCursorAnchor(doc, anchor);
    expect(resolved).toEqual({ offset: 0, lineNumber: 1, column: 1 });
  });

  it('resolves anchor across multiline text', () => {
    const doc = new CrdtDocument('site-1');

    let prev = null;
    for (const ch of 'hello\nworld') {
      const op = doc.localInsert(prev, ch);
      prev = op.char.id;
    }

    const anchor = createCursorAnchorFromPosition(doc, 2, 3);
    const resolved = resolveCursorAnchor(doc, anchor);

    expect(resolved.offset).toBe(8);
    expect(resolved.lineNumber).toBe(2);
    expect(resolved.column).toBe(3);
  });

  it('keeps cursor anchored when remote text is inserted before it', () => {
    const docA = new CrdtDocument('site-A');
    const docB = new CrdtDocument('site-B');

    let prev = null;
    const initialOps = [];
    for (const ch of 'world') {
      const op = docA.localInsert(prev, ch);
      prev = op.char.id;
      initialOps.push(op);
    }
    for (const op of initialOps) {
      docB.integrateRemoteInsert(op);
    }

    const cursorB = createCursorAnchor(docB, 2);
    expect(resolveCursorAnchor(docB, cursorB)).toEqual({
      offset: 2,
      lineNumber: 1,
      column: 3,
    });

    let prevA = null;
    const prefixOps = [];
    for (const ch of 'hello ') {
      const op = docA.localInsert(prevA, ch);
      prevA = op.char.id;
      prefixOps.push(op);
    }

    for (const op of prefixOps) {
      docB.integrateRemoteInsert(op);
    }

    expect(docB.toVisibleString()).toBe('hello world');

    const resolvedB = resolveCursorAnchor(docB, cursorB);
    expect(resolvedB.offset).toBe(8);
    expect(resolvedB.lineNumber).toBe(1);
    expect(resolvedB.column).toBe(9);
  });

  it('falls back to previous character when anchored character is deleted', () => {
    const doc = new CrdtDocument('site-1');

    const opA = doc.localInsert(null, 'a');
    const opB = doc.localInsert(opA.char.id, 'b');
    doc.localInsert(opB.char.id, 'c');

    const anchor = createCursorAnchor(doc, 2);
    expect(anchor.afterId).toEqual(opB.char.id);

    doc.localDelete(opB.char.id);
    expect(doc.toVisibleString()).toBe('ac');

    const resolved = resolveCursorAnchor(doc, anchor);
    expect(resolved.offset).toBe(1);
    expect(resolved.lineNumber).toBe(1);
    expect(resolved.column).toBe(2);
  });

  it('preserves selection anchor range across remote edits', () => {
    const doc = new CrdtDocument('site-1');

    let prev = null;
    for (const ch of 'the quick fox') {
      const op = doc.localInsert(prev, ch);
      prev = op.char.id;
    }

    const selection = createSelectionAnchor(doc, 4, 9);

    let insertPrev = null;
    for (const ch of 'super ') {
      const op = doc.localInsert(insertPrev, ch);
      insertPrev = op.char.id;
    }

    expect(doc.toVisibleString()).toBe('super the quick fox');

    const resolved = resolveSelectionAnchor(doc, selection);
    expect(resolved.start.offset).toBe(10);
    expect(resolved.end.offset).toBe(15);
  });

  it('keeps cursors anchored when a large block of text is inserted earlier', () => {
    const doc1 = new CrdtDocument('site-1');
    const doc2 = new CrdtDocument('site-2');
    const doc3 = new CrdtDocument('site-3');

    const initialText = 'let result = compute(data);\nreturn result;';
    let prev = null;
    const initialOps = [];
    for (const ch of initialText) {
      const op = doc1.localInsert(prev, ch);
      prev = op.char.id;
      initialOps.push(op);
    }
    for (const op of initialOps) {
      doc2.integrateRemoteInsert(op);
      doc3.integrateRemoteInsert(op);
    }

    const cursor1 = createCursorAnchorFromPosition(doc1, 1, 14);
    const cursor2 = createCursorAnchorFromPosition(doc2, 2, 1);

    const block = '// header comment\nimport { utils } from "./utils";\n\n';
    let prev3 = null;
    const blockOps = [];
    for (const ch of block) {
      const op = doc3.localInsert(prev3, ch);
      prev3 = op.char.id;
      blockOps.push(op);
    }

    for (const op of blockOps) {
      doc1.integrateRemoteInsert(op);
      doc2.integrateRemoteInsert(op);
    }

    const resolved1 = resolveCursorAnchor(doc1, cursor1);
    const resolved2 = resolveCursorAnchor(doc2, cursor2);

    const doc1Text = doc1.toVisibleString();
    const doc2Text = doc2.toVisibleString();

    expect(doc1Text.slice(resolved1.offset - 1, resolved1.offset)).toBe(' ');
    expect(doc1Text.slice(resolved1.offset, resolved1.offset + 7)).toBe(
      'compute'
    );

    expect(doc2Text.slice(resolved2.offset - 1, resolved2.offset)).toBe('\n');
    expect(doc2Text.slice(resolved2.offset, resolved2.offset + 6)).toBe(
      'return'
    );
  });
});

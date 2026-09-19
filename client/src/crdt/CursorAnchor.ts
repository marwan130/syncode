import type { CrdtId } from './CrdtId';
import { crdtIdsEqual } from './CrdtId';
import type { CrdtDocument } from './CrdtDocument';

/**
 * represents a cursor anchored to a crdt character id instead of a numeric line/col
 *
 * plain line and column numbers shift whenever remote users type or delete text earlier
 * in the document. anchoring the cursor immediately after a specific crdt character id
 * keeps the cursor attached to that character regardless of remote edits.
 */
export interface CursorAnchor {
  afterId: CrdtId | null;
}

export interface CursorPosition {
  offset: number;
  lineNumber: number;
  column: number;
}

export interface SelectionAnchor {
  anchor: CursorAnchor;
  head: CursorAnchor;
}

export function createCursorAnchor(
  doc: CrdtDocument,
  offset: number
): CursorAnchor {
  if (offset <= 0) {
    return { afterId: null };
  }

  const visibleChars = doc.chars.filter((c) => !c.isDeleted);
  if (visibleChars.length === 0) {
    return { afterId: null };
  }

  const index = Math.min(offset - 1, visibleChars.length - 1);
  return { afterId: visibleChars[index].id };
}

export function createCursorAnchorFromPosition(
  doc: CrdtDocument,
  lineNumber: number,
  column: number
): CursorAnchor {
  const text = doc.toVisibleString();
  let currentLine = 1;
  let currentCol = 1;
  let offset = 0;

  for (let i = 0; i < text.length; i++) {
    if (currentLine === lineNumber && currentCol === column) {
      offset = i;
      return createCursorAnchor(doc, offset);
    }

    if (text[i] === '\n') {
      currentLine++;
      currentCol = 1;
    } else {
      currentCol++;
    }
    offset = i + 1;
  }

  return createCursorAnchor(doc, offset);
}

export function resolveCursorAnchor(
  doc: CrdtDocument,
  anchor: CursorAnchor | null
): CursorPosition {
  if (!anchor || anchor.afterId === null) {
    return { offset: 0, lineNumber: 1, column: 1 };
  }

  let targetIndex = -1;
  for (let i = 0; i < doc.chars.length; i++) {
    if (crdtIdsEqual(doc.chars[i].id, anchor.afterId)) {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex === -1) {
    return { offset: 0, lineNumber: 1, column: 1 };
  }

  let visibleOffset = 0;
  for (let i = 0; i <= targetIndex; i++) {
    if (!doc.chars[i].isDeleted) {
      visibleOffset++;
    }
  }

  const text = doc.toVisibleString();
  const clampedOffset = Math.min(visibleOffset, text.length);

  let lineNumber = 1;
  let column = 1;

  for (let i = 0; i < clampedOffset; i++) {
    if (text[i] === '\n') {
      lineNumber++;
      column = 1;
    } else {
      column++;
    }
  }

  return {
    offset: clampedOffset,
    lineNumber,
    column,
  };
}

export function createSelectionAnchor(
  doc: CrdtDocument,
  startOffset: number,
  endOffset: number
): SelectionAnchor {
  return {
    anchor: createCursorAnchor(doc, startOffset),
    head: createCursorAnchor(doc, endOffset),
  };
}

export function resolveSelectionAnchor(
  doc: CrdtDocument,
  selection: SelectionAnchor | null
): { start: CursorPosition; end: CursorPosition } {
  if (!selection) {
    const fallback: CursorPosition = { offset: 0, lineNumber: 1, column: 1 };
    return { start: fallback, end: fallback };
  }

  return {
    start: resolveCursorAnchor(doc, selection.anchor),
    end: resolveCursorAnchor(doc, selection.head),
  };
}

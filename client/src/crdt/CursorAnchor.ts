import type { CrdtId } from './CrdtId';
import { crdtIdsEqual } from './CrdtId';
import type { CrdtDocument } from './CrdtDocument';

/**
 * represents a cursor anchored between CRDT characters instead of at a numeric line/column
 *
 * plain line and column numbers shift whenever remote users type or delete text earlier
 * in the document. Anchoring both sides preserves the same text position through remote edits.
 */
export interface CursorAnchor {
  afterId: CrdtId | null;
  /** First character after the cursor, used to preserve right-side affinity. */
  beforeId?: CrdtId | null;
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
  const visibleChars = doc.chars.filter((c) => !c.isDeleted);
  let afterId: CrdtId | null = null;
  let textOffset = 0;
  for (const char of visibleChars) {
    const nextOffset = textOffset + char.value.length;
    if (offset < nextOffset) {
      return { afterId, beforeId: char.id };
    }
    afterId = char.id;
    textOffset = nextOffset;
  }
  return { afterId, beforeId: null };
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
  if (!anchor) {
    return startPosition();
  }

  const beforeIndex = findAnchorIndex(doc, anchor.beforeId);
  if (beforeIndex !== -1) {
    return resolveVisibleOffset(doc, visibleOffsetBefore(doc, beforeIndex));
  }

  const afterIndex = findAnchorIndex(doc, anchor.afterId);
  return afterIndex === -1
    ? startPosition()
    : resolveVisibleOffset(doc, visibleOffsetThrough(doc, afterIndex));
}

function startPosition(): CursorPosition {
  return { offset: 0, lineNumber: 1, column: 1 };
}

function findAnchorIndex(
  doc: CrdtDocument,
  id: CrdtId | null | undefined
): number {
  return id ? doc.chars.findIndex((char) => crdtIdsEqual(char.id, id)) : -1;
}

function visibleOffsetBefore(doc: CrdtDocument, index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) {
    if (!doc.chars[i].isDeleted) offset += doc.chars[i].value.length;
  }
  return offset;
}

function visibleOffsetThrough(doc: CrdtDocument, index: number): number {
  return visibleOffsetBefore(doc, index + 1);
}

function resolveVisibleOffset(
  doc: CrdtDocument,
  visibleOffset: number
): CursorPosition {
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

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
    return { offset: 0, lineNumber: 1, column: 1 };
  }

  if (anchor.beforeId) {
    const beforeIndex = doc.chars.findIndex((char) =>
      crdtIdsEqual(char.id, anchor.beforeId!)
    );
    if (beforeIndex !== -1) {
      let visibleOffset = 0;
      for (let i = 0; i < doc.chars.length; i++) {
        const char = doc.chars[i];
        if (i >= beforeIndex && !char.isDeleted) {
          return resolveVisibleOffset(doc, visibleOffset);
        }
        if (!char.isDeleted) {
          visibleOffset += doc.chars[i].value.length;
        }
      }
      // If the target and everything after it were deleted, clamp to EOF.
      return resolveVisibleOffset(doc, visibleOffset);
    }
  }

  if (anchor.afterId === null) {
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
      visibleOffset += doc.chars[i].value.length;
    }
  }

  return resolveVisibleOffset(doc, visibleOffset);
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

import type { CrdtId } from './CrdtId';

/**
 * we keep a tombstone flag instead of deleting the character from memory for concurrent remote operations that reference that character
 * as its originId. RGA works by using a linked list of characters where each node stores the id of the previous node.
 */
export interface CrdtChar {
    id: CrdtId;
    value: string;
    originId: CrdtId | null; // id of the character this was inserted after, null if start of document
    isDeleted: boolean;
}

export function createChar(
    id: CrdtId,
    value: string,
    originId: CrdtId | null
): CrdtChar {
    return {
        id,
        value,
        originId,
        isDeleted: false,
    };
}

import { describe, expect, it } from 'vitest';
import { validatePendingProjectTreeOperations } from '../pendingProjectTreeOutbox';

describe('validatePendingProjectTreeOperations', () => {
  it('keeps valid operations and drops malformed or conflicting records', () => {
    const valid = {
      type: 'create',
      opId: { siteId: 'site-a', counter: 1 },
      entry: {
        id: 'file-a',
        name: 'main.ts',
        parentId: null,
        isFolder: false,
      },
    };

    expect(
      validatePendingProjectTreeOperations([
        valid,
        null,
        { ...valid, entry: { ...valid.entry, name: 'different.ts' } },
      ])
    ).toEqual([valid]);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveFileDiagnostics } from '../fileExplorerUtils';
import type { RoomEntry } from '../../../providers/SignalRCrdtProvider';

const entries: RoomEntry[] = [
  { id: 'src', name: 'src', parentId: null, isFolder: true },
  { id: 'nested', name: 'nested', parentId: 'src', isFolder: true },
  { id: 'good', name: 'good.ts', parentId: 'nested', isFolder: false },
  { id: 'warn', name: 'warn.ts', parentId: 'src', isFolder: false },
  { id: 'error', name: 'error.ts', parentId: 'nested', isFolder: false },
];

const childrenByParent = new Map<string | null, RoomEntry[]>([
  [null, [entries[0]!]],
  ['src', [entries[1], entries[3]]],
  ['nested', [entries[2], entries[4]]],
]);

describe('resolveFileDiagnostics', () => {
  it('propagates the most severe descendant diagnostic to parent folders', () => {
    expect(
      resolveFileDiagnostics(entries, childrenByParent, {
        warn: 'warning',
        error: 'error',
      })
    ).toEqual({
      src: 'error',
      nested: 'error',
      warn: 'warning',
      error: 'error',
    });
  });

  it('propagates warnings when no descendant has an error', () => {
    expect(
      resolveFileDiagnostics(entries, childrenByParent, {
        warn: 'warning',
      })
    ).toEqual({ src: 'warning', warn: 'warning' });
  });

  it('terminates when folder entries contain a cycle', () => {
    const cyclic = new Map(childrenByParent);
    cyclic.set('nested', [...(cyclic.get('nested') ?? []), entries[0]!]);
    expect(
      resolveFileDiagnostics(entries, cyclic, { good: 'warning' }).src
    ).toBe('warning');
  });
});

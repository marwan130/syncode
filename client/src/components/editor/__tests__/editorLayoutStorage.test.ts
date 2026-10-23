import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomEntry } from '../../../providers/SignalRCrdtProvider';
import {
  DEFAULT_EXPLORER_WIDTH,
  DEFAULT_PREVIEW_WIDTH,
  DEFAULT_TERMINAL_HEIGHT,
  MIN_PREVIEW_WIDTH,
  getEntryPath,
  getStoredExplorerWidth,
  getStoredPreviewWidth,
  getStoredTerminalHeight,
  getStoredActiveFileId,
  storeActiveFileId,
  storeExplorerWidth,
  storePreviewWidth,
  storeTerminalHeight,
} from '../editorLayoutStorage';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
}

afterEach(() => vi.unstubAllGlobals());

describe('editor layout persistence', () => {
  it('uses defaults when saved panel sizes are missing or invalid', () => {
    vi.stubGlobal('localStorage', createStorage());

    expect(getStoredTerminalHeight()).toBe(DEFAULT_TERMINAL_HEIGHT);
    expect(getStoredExplorerWidth()).toBe(DEFAULT_EXPLORER_WIDTH);
    expect(getStoredPreviewWidth()).toBe(DEFAULT_PREVIEW_WIDTH);
  });

  it('persists panel sizes and clamps oversized values', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);

    storeTerminalHeight(900);
    storeExplorerWidth(800);
    storePreviewWidth(1200);

    expect(getStoredTerminalHeight()).toBe(700);
    expect(getStoredExplorerWidth()).toBe(600);
    expect(getStoredPreviewWidth()).toBe(1000);
  });

  it('falls back when a stored size is below its minimum', () => {
    const storage = createStorage();
    storage.setItem(
      'syncode_live_preview_width',
      String(MIN_PREVIEW_WIDTH - 1)
    );
    vi.stubGlobal('localStorage', storage);

    expect(getStoredPreviewWidth()).toBe(DEFAULT_PREVIEW_WIDTH);
  });

  it('stores the active file per room session', () => {
    const storage = createStorage();
    vi.stubGlobal('sessionStorage', storage);

    expect(getStoredActiveFileId('room-a')).toBeNull();
    storeActiveFileId('room-a', 'file-a');

    expect(getStoredActiveFileId('room-a')).toBe('file-a');
    expect(getStoredActiveFileId('room-b')).toBeNull();
  });
});

describe('getEntryPath', () => {
  const entries = [
    { id: 'src', name: 'src', parentId: null, isFolder: true },
    { id: 'components', name: 'components', parentId: 'src', isFolder: true },
    { id: 'app', name: 'App.tsx', parentId: 'components', isFolder: false },
  ] as RoomEntry[];

  it('combines the parent names into a project relative path', () => {
    expect(getEntryPath(entries[2], entries)).toBe('src/components/App.tsx');
  });

  it('stops when a parent is missing or is not a folder', () => {
    const orphan = {
      id: 'orphan',
      name: 'file.ts',
      parentId: 'missing',
      isFolder: false,
    } as RoomEntry;
    expect(getEntryPath(orphan, entries)).toBe('file.ts');
  });
});

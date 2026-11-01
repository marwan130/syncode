import { describe, expect, it } from 'vitest';
import {
  inspectFolderFiles,
  MAX_IMPORT_TOTAL_BYTES,
  readSelectedImportFiles,
} from '../folderImport';

function source(path: string, content: string): { path: string; file: File } {
  return { path, file: new File([content], path.split('/').at(-1) ?? 'file') };
}

describe('folder import safety', () => {
  it('keeps safe Unicode paths and skips traversal, duplicate, and secret paths', async () => {
    const result = await inspectFolderFiles([
      source('src/éclair.ts', 'const ok = true;'),
      source('../escape.ts', 'outside'),
      source('src/../escape.ts', 'outside'),
      source('.env.local', 'secret'),
      source('SRC/ÉCLAIR.TS', 'duplicate'),
    ]);

    expect(result.candidates.map(({ path }) => path)).toEqual([
      'src/éclair.ts',
    ]);
    expect(result.skipped.map(({ reason }) => reason)).toEqual([
      'Unsafe file path',
      'Unsafe file path',
      'Environment file may contain secrets',
      'Duplicate path',
    ]);
  });

  it('skips files above the per-file limit and reports a bounded scan', async () => {
    const oversized = source('large.ts', 'x'.repeat(64 * 1024 + 1));
    const scanned = await inspectFolderFiles([
      oversized,
      ...Array.from({ length: 5000 }, (_, index) =>
        source(`src/${index}.ts`, '')
      ),
    ]);

    expect(scanned.candidates).toHaveLength(500);
    expect(scanned.skipped).toContainEqual({
      path: 'large.ts',
      reason: 'File exceeds the 64 KB per-file limit',
    });
    expect(scanned.skipped.at(-1)).toEqual({
      path: 'Additional folder contents',
      reason: 'Preview limited to 5000 entries',
    });
    expect(scanned.skipped).toContainEqual({
      path: 'src/500.ts',
      reason: 'Folder exceeds the 500-file limit',
    });
  });

  it('rejects selections that exceed the total byte limit', async () => {
    const files = Array.from({ length: 17 }, (_, index) => ({
      path: `${index}.ts`,
      file: new File(['x'.repeat(64 * 1024)], `${index}.ts`),
      size: 64 * 1024,
      selected: true,
    }));

    expect(MAX_IMPORT_TOTAL_BYTES).toBe(1024 * 1024);
    await expect(readSelectedImportFiles(files)).rejects.toThrow(
      'The selected files exceed the 1 MB total import limit.'
    );
  });
});

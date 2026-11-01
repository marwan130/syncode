import { describe, expect, it } from 'vitest';
import type * as monaco from 'monaco-editor';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { computeFileDiagnostics } from '../useFileDiagnostics';

const entries: RoomEntry[] = [
  { id: 'src', name: 'src', parentId: null, isFolder: true },
  { id: 'file', name: 'main.ts', parentId: 'src', isFolder: false },
];

function marker(
  path: string,
  severity: number,
  scheme = 'file'
): monaco.editor.IMarker {
  return {
    resource: { path, scheme, toString: () => `${scheme}://${path}` },
    severity,
    startLineNumber: 3,
    startColumn: 2,
    message: 'diagnostic',
  } as monaco.editor.IMarker;
}

describe('file diagnostics', () => {
  it('maps Monaco markers to their room files and keeps the highest severity', () => {
    const result = computeFileDiagnostics(
      [
        marker('/workspace/src/main.ts', 4),
        marker('/workspace/src/main.ts', 8),
      ],
      entries
    );

    expect(result.byFile.file).toBe('error');
    expect(result.problems).toHaveLength(2);
    expect(result.problems.map((problem) => problem.severity)).toEqual([
      'warning',
      'error',
    ]);
  });

  it('maps stable Monaco model URIs to files after a rename', () => {
    const result = computeFileDiagnostics(
      [marker('/files/file', 8, 'syncode')],
      entries
    );

    expect(result.byFile.file).toBe('error');
    expect(result.problems).toMatchObject([
      { fileId: 'file', path: 'src/main.ts', severity: 'error' },
    ]);
  });

  it('ignores folders, unrelated files, and informational markers', () => {
    const result = computeFileDiagnostics(
      [
        marker('/workspace/src/other.ts', 8),
        marker('/workspace/src/main.ts', 2),
      ],
      entries
    );

    expect(result).toEqual({ byFile: {}, problems: [] });
  });
});

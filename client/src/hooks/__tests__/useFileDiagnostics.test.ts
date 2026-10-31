import { describe, expect, it } from 'vitest';
import type * as monaco from 'monaco-editor';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { computeFileDiagnostics } from '../useFileDiagnostics';

const entries: RoomEntry[] = [
  { id: 'src', name: 'src', parentId: null, isFolder: true },
  { id: 'file', name: 'main.ts', parentId: 'src', isFolder: false },
];

function marker(path: string, severity: number): monaco.editor.IMarker {
  return {
    resource: { path, toString: () => `file://${path}` },
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

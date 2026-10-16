import { useEffect, useState } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import type { RoomEntry } from '../providers/SignalRCrdtProvider';
import { getEntryPath } from '../components/editor/editorLayoutStorage';

type DiagnosticSeverity = 'error' | 'warning';
type FileDiagnosticsMap = Record<string, DiagnosticSeverity>;

/**
 * Computes diagnostic severities for each room file
 * by querying Monaco's native marker service.
 */
function computeFileDiagnostics(
  monacoApi: Monaco,
  entries: RoomEntry[]
): FileDiagnosticsMap {
  const allMarkers = monacoApi.editor.getModelMarkers({});
  const result: FileDiagnosticsMap = {};

  for (const entry of entries) {
    if (entry.isFolder) continue;
    const entryPath = getEntryPath(entry, entries)
      .replace(/^\/+/, '')
      .toLowerCase();

    const fileMarkers = allMarkers.filter((m: monaco.editor.IMarker) => {
      const markerPath = m.resource.path.replace(/^\/+/, '').toLowerCase();
      return (
        markerPath === entryPath ||
        markerPath.endsWith('/' + entryPath) ||
        m.resource.toString().toLowerCase().endsWith(entryPath)
      );
    });

    let hasError = false;
    let hasWarning = false;

    for (const marker of fileMarkers) {
      if (marker.severity === 8) {
        hasError = true;
        break;
      } else if (marker.severity === 4) {
        hasWarning = true;
      }
    }

    if (hasError) {
      result[entry.id] = 'error';
    } else if (hasWarning) {
      result[entry.id] = 'warning';
    }
  }

  return result;
}

interface UseFileDiagnosticsOptions {
  monacoApi: Monaco | null;
  entries: RoomEntry[];
}

export function useFileDiagnostics({
  monacoApi,
  entries,
}: UseFileDiagnosticsOptions): FileDiagnosticsMap {
  const [diagnostics, setDiagnostics] = useState<FileDiagnosticsMap>({});

  useEffect(() => {
    if (!monacoApi) return;

    const update = () => {
      setDiagnostics(computeFileDiagnostics(monacoApi, entries));
    };

    update();

    const disposable = monacoApi.editor.onDidChangeMarkers(update);
    return () => disposable.dispose();
  }, [monacoApi, entries]);

  return diagnostics;
}

import { useEffect, useState } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import type { RoomEntry } from '../providers/SignalRCrdtProvider';
import { getEntryPath } from '../components/editor/editorLayoutStorage';

export type DiagnosticSeverity = 'error' | 'warning';
export type FileDiagnosticsMap = Record<string, DiagnosticSeverity>;
export interface FileProblem {
  fileId: string;
  path: string;
  line: number;
  column: number;
  message: string;
  severity: DiagnosticSeverity;
}
export interface FileDiagnosticsResult {
  byFile: FileDiagnosticsMap;
  problems: FileProblem[];
}

/**
 * Computes diagnostic severities for each room file
 * by querying Monaco's native marker service.
 */
export function computeFileDiagnostics(
  allMarkers: monaco.editor.IMarker[],
  entries: RoomEntry[]
): FileDiagnosticsResult {
  const result: FileDiagnosticsMap = {};
  const problems: FileProblem[] = [];

  for (const entry of entries) {
    if (entry.isFolder) continue;
    const path = getEntryPath(entry, entries);
    const normalizedPath = normalizePath(path);
    for (const marker of allMarkers) {
      if (
        !markerMatchesEntry(marker, entry.id) &&
        !markerMatchesPath(marker, normalizedPath)
      )
        continue;
      const severity = getDiagnosticSeverity(marker.severity);
      if (!severity) continue;
      problems.push({
        fileId: entry.id,
        path,
        line: marker.startLineNumber,
        column: marker.startColumn,
        message: marker.message,
        severity,
      });
      result[entry.id] = mostSevere(result[entry.id], severity);
    }
  }

  return { byFile: result, problems };
}

function markerMatchesEntry(
  marker: monaco.editor.IMarker,
  fileId: string
): boolean {
  if (marker.resource.scheme !== 'syncode') return false;
  const match = marker.resource.path.match(/^\/files\/([^/]+)$/);
  if (!match) return false;
  try {
    return decodeURIComponent(match[1]) === fileId;
  } catch {
    return false;
  }
}

function normalizePath(path: string): string {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    decodedPath = path;
  }
  return decodedPath.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase();
}

function markerMatchesPath(
  marker: monaco.editor.IMarker,
  path: string
): boolean {
  const markerPath = normalizePath(marker.resource.path);
  const markerUriPath = normalizePath(marker.resource.toString());
  return (
    markerPath === path ||
    markerPath.endsWith(`/${path}`) ||
    markerUriPath.endsWith(`/${path}`) ||
    markerUriPath === path
  );
}

function getDiagnosticSeverity(severity: number): DiagnosticSeverity | null {
  if (severity === 8) return 'error';
  if (severity === 4) return 'warning';
  return null;
}

function mostSevere(
  current: DiagnosticSeverity | undefined,
  next: DiagnosticSeverity
): DiagnosticSeverity {
  return current === 'error' || next === 'error' ? 'error' : 'warning';
}

export interface UseFileDiagnosticsOptions {
  monacoApi: Monaco | null;
  entries: RoomEntry[];
}

export function useFileDiagnostics({
  monacoApi,
  entries,
}: UseFileDiagnosticsOptions): FileDiagnosticsResult {
  const [diagnostics, setDiagnostics] = useState<FileDiagnosticsResult>({
    byFile: {},
    problems: [],
  });

  useEffect(() => {
    if (!monacoApi) return;

    const update = () => {
      setDiagnostics(
        computeFileDiagnostics(monacoApi.editor.getModelMarkers({}), entries)
      );
    };

    update();

    const disposable = monacoApi.editor.onDidChangeMarkers(update);
    return () => disposable.dispose();
  }, [monacoApi, entries]);

  return diagnostics;
}

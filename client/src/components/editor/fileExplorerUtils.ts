import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import type { GithubChangeStatus } from '../../github/changeTracker';
import { getEntryPath } from './editorLayoutStorage';

const EXTENSION_ICONS: Record<string, string> = {
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  env: 'dotenv',
  htm: 'html',
  html: 'html',
  java: 'java',
  js: 'js',
  cjs: 'js',
  mjs: 'js',
  json: 'json',
  md: 'markdown',
  py: 'python',
  pyw: 'python',
  rs: 'rust',
  sh: 'shell',
  bash: 'shell',
  svg: 'svg',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'reactjs',
  jsx: 'reactjs',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  txt: 'text',
};

export type FileDiagnostic = 'error' | 'warning';
export type FileDiagnostics = Record<string, FileDiagnostic>;

export interface FileExplorerGitStatus {
  kind: GithubChangeStatus['kind'] | 'mixed';
  changeCount: number;
}

export type FileStatusTone = 'added' | 'warning' | 'error';

export function getFileStatusTone(
  diagnostic: FileDiagnostic | undefined,
  changeKind: FileExplorerGitStatus['kind'] | undefined
): FileStatusTone | undefined {
  if (diagnostic === 'error' || changeKind === 'deleted') return 'error';
  if (
    diagnostic === 'warning' ||
    changeKind === 'modified' ||
    changeKind === 'mixed'
  )
    return 'warning';
  return changeKind === 'added' ? 'added' : undefined;
}

export function getFileExplorerIndent(depth: number): number {
  return 8 + Math.min(depth, 4) * 14;
}

export function resolveFileExplorerGitStatus(
  entries: RoomEntry[],
  changes: GithubChangeStatus[]
): Map<string, FileExplorerGitStatus> {
  const entriesByPath = new Map(
    entries.map((entry) => [getEntryPath(entry, entries), entry])
  );
  const changesByEntry = new Map<string, GithubChangeStatus[]>();

  for (const change of changes) {
    const file = entriesByPath.get(change.path);
    if (file && !file.isFolder) addChange(changesByEntry, file.id, change);

    const pathParts = change.path.split('/');
    pathParts.pop();
    while (pathParts.length) {
      const folder = entriesByPath.get(pathParts.join('/'));
      if (folder?.isFolder) addChange(changesByEntry, folder.id, change);
      pathParts.pop();
    }
  }

  return new Map(
    [...changesByEntry].map(([entryId, entryChanges]) => [
      entryId,
      summarizeChanges(entryChanges),
    ])
  );
}

function addChange(
  changesByEntry: Map<string, GithubChangeStatus[]>,
  entryId: string,
  change: GithubChangeStatus
): void {
  const entryChanges = changesByEntry.get(entryId) ?? [];
  entryChanges.push(change);
  changesByEntry.set(entryId, entryChanges);
}

function summarizeChanges(
  changes: GithubChangeStatus[]
): FileExplorerGitStatus {
  const kinds = new Set(changes.map((change) => change.kind));
  return {
    kind: kinds.size === 1 ? changes[0].kind : 'mixed',
    changeCount: new Set(changes.map((change) => change.path)).size,
  };
}

export function getFileIcon(
  entry: Pick<RoomEntry, 'name' | 'isFolder'>,
  expanded: boolean
): string {
  if (entry.isFolder)
    return `vscode-icons:default-folder${expanded ? '-opened' : ''}`;

  const name = entry.name.toLowerCase();
  if (name === 'dockerfile') return 'vscode-icons:file-type-docker';
  if (name === 'package.json') return 'vscode-icons:file-type-npm';
  const extension = name.split('.').pop() ?? '';
  return `vscode-icons:file-type-${EXTENSION_ICONS[extension] ?? 'text'}`;
}

export function groupEntriesByParent(
  entries: RoomEntry[]
): Map<string | null, RoomEntry[]> {
  const children = new Map<string | null, RoomEntry[]>();
  for (const entry of entries) {
    const siblings = children.get(entry.parentId) ?? [];
    siblings.push(entry);
    children.set(entry.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort(
      (a, b) =>
        Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name)
    );
  }
  return children;
}

export function getMovableEntry(
  entries: RoomEntry[],
  entryId: string,
  targetParentId: string | null
): RoomEntry | null {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const entry = entriesById.get(entryId);
  if (!entry || !isValidTarget(entry, targetParentId, entriesById)) return null;
  if (
    entry.isFolder &&
    createsFolderCycle(entry.id, targetParentId, entriesById)
  )
    return null;
  return entry;
}

function isValidTarget(
  entry: RoomEntry,
  targetParentId: string | null,
  entriesById: Map<string, RoomEntry>
): boolean {
  if (entry.id === targetParentId) return false;
  if (!targetParentId) return true;
  return entriesById.get(targetParentId)?.isFolder === true;
}

function createsFolderCycle(
  entryId: string,
  targetParentId: string | null,
  entriesById: Map<string, RoomEntry>
): boolean {
  let currentId = targetParentId;
  const visited = new Set<string>();
  while (currentId) {
    if (currentId === entryId || visited.has(currentId)) return true;
    visited.add(currentId);
    currentId = entriesById.get(currentId)?.parentId ?? null;
  }
  return false;
}

export function resolveFileDiagnostics(
  entries: RoomEntry[],
  childrenByParent: Map<string | null, RoomEntry[]>,
  fileDiagnostics: FileDiagnostics = {}
): FileDiagnostics {
  const diagnosticsByEntry: FileDiagnostics = {};

  for (const entry of entries) {
    if (!entry.isFolder) {
      const severity = fileDiagnostics[entry.id];
      if (severity) diagnosticsByEntry[entry.id] = severity;
      continue;
    }

    const severity = resolveFolderDiagnostic(
      entry.id,
      childrenByParent,
      fileDiagnostics
    );
    if (severity) diagnosticsByEntry[entry.id] = severity;
  }

  return diagnosticsByEntry;
}

function resolveFolderDiagnostic(
  folderId: string,
  childrenByParent: Map<string | null, RoomEntry[]>,
  fileDiagnostics: FileDiagnostics
): FileDiagnostic | undefined {
  const pending = [...(childrenByParent.get(folderId) ?? [])];
  const visited = new Set<string>([folderId]);
  let hasWarning = false;

  while (pending.length) {
    const child = pending.pop();
    if (!child || !markVisited(visited, child.id)) continue;
    const severity = fileDiagnostics[child.id];
    if (severity === 'error') return 'error';
    hasWarning ||= severity === 'warning';
    addChildrenToPending(child, childrenByParent, pending);
  }

  return hasWarning ? 'warning' : undefined;
}

function markVisited(visited: Set<string>, id: string): boolean {
  if (visited.has(id)) return false;
  visited.add(id);
  return true;
}

function addChildrenToPending(
  entry: RoomEntry,
  childrenByParent: Map<string | null, RoomEntry[]>,
  pending: RoomEntry[]
): void {
  if (entry.isFolder) pending.push(...(childrenByParent.get(entry.id) ?? []));
}

import type { RoomEntry } from '../../providers/SignalRCrdtProvider';

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
    if (!child || visited.has(child.id)) continue;
    visited.add(child.id);
    const severity = fileDiagnostics[child.id];
    if (severity === 'error') return 'error';
    if (severity === 'warning') hasWarning = true;
    if (child.isFolder) {
      pending.push(...(childrenByParent.get(child.id) ?? []));
    }
  }

  return hasWarning ? 'warning' : undefined;
}

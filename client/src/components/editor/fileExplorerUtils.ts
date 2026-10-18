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

export function resolveFileDiagnostics(
  entries: RoomEntry[],
  childrenByParent: Map<string | null, RoomEntry[]>,
  fileDiagnostics: FileDiagnostics = {}
): FileDiagnostics {
  const diagnosticsByEntry: FileDiagnostics = {};

  for (const entry of entries) {
    let severity = fileDiagnostics[entry.id];
    if (!entry.isFolder) {
      if (severity) diagnosticsByEntry[entry.id] = severity;
      continue;
    }

    const pending = [...(childrenByParent.get(entry.id) ?? [])];
    const visited = new Set<string>([entry.id]);
    while (pending.length && severity !== 'error') {
      const child = pending.pop();
      if (!child || visited.has(child.id)) continue;
      visited.add(child.id);
      const childSeverity = fileDiagnostics[child.id];
      if (childSeverity === 'error') {
        severity = 'error';
        break;
      }
      if (childSeverity === 'warning') severity = 'warning';
      if (child.isFolder) {
        pending.push(...(childrenByParent.get(child.id) ?? []));
      }
    }
    if (severity) diagnosticsByEntry[entry.id] = severity;
  }

  return diagnosticsByEntry;
}

import type { RoomEntry } from '../providers/SignalRCrdtProvider';

const generatedDirectories = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.venv',
  '__pycache__',
  'bin',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'obj',
  'out',
  'packages',
  'target',
  'vendor',
  'venv',
]);
const generatedExtensions = new Set([
  '.class',
  '.dll',
  '.exe',
  '.o',
  '.obj',
  '.pdb',
  '.pyc',
  '.so',
]);

export function isSharedProjectPath(path: string): boolean {
  if (
    !path ||
    path.length > 512 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    hasControlCharacter(path)
  )
    return false;
  const segments = path.split('/');
  if (
    segments.length > 32 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        /[:*?"<>|]/.test(segment)
    )
  )
    return false;
  return (
    !segments.some((segment) =>
      generatedDirectories.has(segment.toLowerCase())
    ) && !generatedExtensions.has(extensionOf(path))
  );
}

function hasControlCharacter(path: string): boolean {
  for (const character of path) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function getProjectEntryPath(
  entry: RoomEntry,
  entries: RoomEntry[]
): string | null {
  const segments = [entry.name];
  const visited = new Set([entry.id]);
  let parentId = entry.parentId;
  while (parentId) {
    if (visited.has(parentId)) return null;
    visited.add(parentId);
    const parent = entries.find(
      (item) => item.id === parentId && item.isFolder
    );
    if (!parent) return null;
    segments.unshift(parent.name);
    parentId = parent.parentId;
  }
  return segments.join('/');
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

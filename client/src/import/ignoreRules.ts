const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'bower_components',
  '.next',
  '.nuxt',
  '.vite',
  'build',
  'dist',
  'out',
  'target',
  'bin',
  'obj',
  'coverage',
]);

const IGNORED_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const PRIVATE_FILE_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.crt',
  '.cer',
  '.der',
  '.ppk',
  '.keystore',
  '.jks',
]);
const BINARY_FILE_EXTENSIONS = new Set([
  '.7z',
  '.avi',
  '.bin',
  '.bmp',
  '.class',
  '.dll',
  '.doc',
  '.docx',
  '.eot',
  '.exe',
  '.gif',
  '.gz',
  '.ico',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.mp4',
  '.pdf',
  '.png',
  '.so',
  '.tar',
  '.ttf',
  '.wasm',
  '.webp',
  '.woff',
  '.woff2',
  '.xls',
  '.xlsx',
  '.zip',
]);

export function getIgnoredDirectoryPath(path: string): string | null {
  const segments = path.split('/');
  const index = segments.findIndex((segment) =>
    IGNORED_DIRECTORIES.has(segment.toLowerCase())
  );
  return index < 0 ? null : segments.slice(0, index + 1).join('/');
}

export function getImportIgnoreReason(
  path: string,
  isDirectory: boolean
): string | null {
  const segments = path.split('/').map((segment) => segment.toLowerCase());
  const name = segments.at(-1) ?? '';
  const ignoredPath = getIgnoredDirectoryPath(path);
  if (ignoredPath && ignoredPath !== path)
    return 'Inside an ignored generated or dependency folder';

  return (
    getIgnoredDirectoryReason(name, isDirectory) ??
    getIgnoredSensitiveFileReason(name) ??
    getIgnoredBinaryFileReason(name, isDirectory)
  );
}

function getIgnoredDirectoryReason(
  name: string,
  isDirectory: boolean
): string | null {
  return isDirectory && IGNORED_DIRECTORIES.has(name)
    ? 'Generated or dependency folder'
    : null;
}

function getIgnoredSensitiveFileReason(name: string): string | null {
  const extensionIndex = name.lastIndexOf('.');
  const extension = extensionIndex > 0 ? name.slice(extensionIndex) : '';
  if (IGNORED_FILES.has(name)) return 'Operating system file';
  if (name.startsWith('.env')) return 'Environment file may contain secrets';
  if (name === '.npmrc' || name === '.pypirc')
    return 'Package credentials may be present';
  if (name.startsWith('id_rsa') || name.startsWith('id_ed25519'))
    return 'Private key';
  if (PRIVATE_FILE_EXTENSIONS.has(extension))
    return 'Private key or certificate';
  return null;
}

function getIgnoredBinaryFileReason(
  name: string,
  isDirectory: boolean
): string | null {
  if (isDirectory) return null;
  const extensionIndex = name.lastIndexOf('.');
  const extension = extensionIndex > 0 ? name.slice(extensionIndex) : '';
  return BINARY_FILE_EXTENSIONS.has(extension) ? 'Binary file' : null;
}

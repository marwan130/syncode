import { strToU8, zipSync } from 'fflate';
import type { ImportedFileContent } from './folderImport';
import { normalizeImportPath } from './pathSafety';

export function downloadProjectZip(
  files: ImportedFileContent[],
  projectName: string
): void {
  const archiveFiles: Record<string, Uint8Array> = {};
  for (const file of files) {
    archiveFiles[normalizeImportPath(file.path)] = strToU8(file.content);
  }

  const archive = zipSync(archiveFiles, { level: 6 });
  const blob = new Blob([archive], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${getSafeArchiveName(projectName)}.zip`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getSafeArchiveName(name: string): string {
  const safeName = [...name.replace(/[\\/:*?"<>|]/g, '-')]
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
    .trim()
    .replace(/\.+$/g, '');
  return safeName || 'syncode-project';
}

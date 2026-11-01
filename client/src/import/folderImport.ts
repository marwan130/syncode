import { getIgnoredDirectoryPath, getImportIgnoreReason } from './ignoreRules';
import { normalizeImportPath } from './pathSafety';
import { CrdtDocument } from '../crdt/CrdtDocument';
import { compressCrdtSnapshot } from '../crdt/snapshotCompression';

export const MAX_IMPORT_TOTAL_BYTES = 1024 * 1024;
const MAX_IMPORT_FILE_COUNT = 500;
const MAX_IMPORT_FILE_BYTES = 64 * 1024;
const MAX_IMPORT_FILE_COMPRESSED_BYTES = 1024 * 1024;
const MAX_IMPORT_TOTAL_SNAPSHOT_BYTES = 192 * 1024 * 1024;
const MAX_IMPORT_TOTAL_COMPRESSED_BYTES = 10 * 1024 * 1024;

export interface ImportFileCandidate {
  path: string;
  file: File;
  size: number;
  selected: boolean;
}

export interface ImportedFileContent {
  path: string;
  content: string;
}

export interface ImportSnapshot {
  path: string;
  id: string;
  compressedSnapshot: string;
}

export interface FolderInspection {
  candidates: ImportFileCandidate[];
  skipped: Array<{ path: string; reason: string }>;
}

export interface FolderFileSource {
  path: string;
  file: File;
}

interface WritableFileHandle {
  createWritable: () => Promise<{
    write: (content: string) => Promise<void>;
    close: () => Promise<void>;
    abort?: () => Promise<void>;
  }>;
}

interface WritableDirectoryHandle {
  getDirectoryHandle?: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<WritableDirectoryHandle>;
  getFileHandle?: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<WritableFileHandle>;
  requestPermission?: (options: {
    mode: 'readwrite';
  }) => Promise<PermissionState>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: {
    mode?: 'readwrite';
  }) => Promise<WritableDirectoryHandle>;
}

const MAX_SCANNED_ENTRIES = 5000;

interface OpenFilePickerWindow extends Window {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
  }) => Promise<Array<{ getFile: () => Promise<File>; name: string }>>;
}

function supportsOpenFilePicker(): boolean {
  return (
    typeof (window as OpenFilePickerWindow).showOpenFilePicker === 'function'
  );
}

export async function pickAndImportLocalFile(
  onImport: (files: ImportedFileContent[]) => Promise<void>
): Promise<void> {
  let file: File | undefined;
  if (supportsOpenFilePicker()) {
    try {
      const picker = (window as OpenFilePickerWindow).showOpenFilePicker;
      if (picker) {
        const handles = await picker.call(window, { multiple: false });
        if (handles[0]) {
          file = await handles[0].getFile();
        }
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError')
        return;
      throw reason;
    }
  }
  if (!file) {
    file = await new Promise<File | undefined>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      input.onchange = () => {
        resolve(input.files?.[0]);
        input.remove();
      };
      input.oncancel = () => {
        resolve(undefined);
        input.remove();
      };
      document.body.appendChild(input);
      input.click();
    });
  }
  if (!file) return;

  const inspection = await inspectFolderFiles([{ path: file.name, file }]);
  const candidates = inspection.candidates.filter((c) => c.selected);
  if (!candidates.length) {
    const skipReason =
      inspection.skipped[0]?.reason ?? 'This file cannot be imported.';
    throw new Error(skipReason);
  }
  const files = await readSelectedImportFiles(candidates);
  await onImport(files);
}

async function pickFolderFiles(): Promise<{
  files: FolderFileSource[];
  skipped: FolderInspection['skipped'];
  folderName?: string;
}> {
  return pickFolderFilesFromInput();
}

export interface LocalFolderImportPreview extends FolderInspection {
  folderName?: string;
}

export async function pickLocalFolderForImport(): Promise<LocalFolderImportPreview | null> {
  const { files, skipped, folderName } = await pickFolderFiles();
  if (!folderName && files.length === 0 && skipped.length === 0) return null;

  const inspection = await inspectFolderFiles(files, skipped);
  return { ...inspection, folderName };
}

function pickFolderFilesFromInput(): Promise<{
  files: FolderFileSource[];
  skipped: FolderInspection['skipped'];
  folderName?: string;
}> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.style.display = 'none';
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      const firstRelativePath = files[0]?.webkitRelativePath ?? '';
      const folderName = firstRelativePath.split('/')[0] || undefined;
      resolve({
        files: files.map((file) => ({
          path: file.webkitRelativePath.split('/').slice(1).join('/'),
          file,
        })),
        skipped: [],
        folderName,
      });
      input.remove();
    };
    input.oncancel = () => {
      resolve({ files: [], skipped: [] });
      input.remove();
    };
    document.body.appendChild(input);
    try {
      input.click();
    } catch (error) {
      input.remove();
      reject(error);
    }
  });
}

export async function inspectFolderFiles(
  files: FolderFileSource[],
  initiallySkipped: FolderInspection['skipped'] = []
): Promise<FolderInspection> {
  const candidates: ImportFileCandidate[] = [];
  const skipped: FolderInspection['skipped'] = [...initiallySkipped];
  const seenPaths = new Set<string>();
  const seenSkippedPaths = new Set(
    skipped.map((item) => item.path.toLocaleLowerCase('en-US'))
  );

  for (const source of files.slice(0, MAX_SCANNED_ENTRIES)) {
    const inspected = await inspectSource(source, seenPaths, candidates.length);
    if (inspected.candidate) {
      candidates.push(inspected.candidate);
      continue;
    }
    if (!inspected.skipped) continue;

    const skippedPath =
      inspected.skipped.ignoredDirectory ?? inspected.skipped.path;
    const skippedKey = skippedPath.toLocaleLowerCase('en-US');
    if (seenSkippedPaths.has(skippedKey)) continue;
    skipped.push({ path: skippedPath, reason: inspected.skipped.reason });
    seenSkippedPaths.add(skippedKey);
  }

  if (files.length > MAX_SCANNED_ENTRIES) {
    skipped.push({
      path: 'Additional folder contents',
      reason: 'Preview limited to 5000 entries',
    });
  }

  return { candidates, skipped };
}

export async function readSelectedImportFiles(
  candidates: ImportFileCandidate[]
): Promise<ImportedFileContent[]> {
  const selected = candidates.filter((candidate) => candidate.selected);
  if (selected.length === 0)
    throw new Error('Select at least one file to import.');
  if (selected.length > MAX_IMPORT_FILE_COUNT)
    throw new Error('The import exceeds the 500-file limit.');
  if (selected.some((candidate) => candidate.size > MAX_IMPORT_FILE_BYTES))
    throw new Error('A selected file exceeds the 64 KB per-file limit.');
  if (
    selected.reduce((total, candidate) => total + candidate.size, 0) >
    MAX_IMPORT_TOTAL_BYTES
  )
    throw new Error('The selected files exceed the 1 MB total import limit.');

  return Promise.all(
    selected.map(async ({ path, file }) => ({
      path,
      content: await file.text(),
    }))
  );
}

interface InspectedSource {
  candidate?: ImportFileCandidate;
  skipped?: {
    path: string;
    reason: string;
    ignoredDirectory?: string;
  };
}

async function inspectSource(
  source: FolderFileSource,
  seenPaths: Set<string>,
  candidateCount: number
): Promise<InspectedSource> {
  let path: string;
  try {
    path = normalizeImportPath(source.path);
  } catch {
    return {
      skipped: { path: source.path.slice(0, 512), reason: 'Unsafe file path' },
    };
  }

  const pathKey = path.toLocaleLowerCase('en-US');
  if (seenPaths.has(pathKey))
    return { skipped: { path, reason: 'Duplicate path' } };
  seenPaths.add(pathKey);

  const ignoreReason = getImportIgnoreReason(path, false);
  if (ignoreReason) {
    return {
      skipped: {
        path,
        reason: ignoreReason,
        ignoredDirectory: getIgnoredDirectoryPath(path) ?? undefined,
      },
    };
  }
  if (source.file.size > MAX_IMPORT_FILE_BYTES)
    return {
      skipped: { path, reason: 'File exceeds the 64 KB per-file limit' },
    };
  if (candidateCount >= MAX_IMPORT_FILE_COUNT)
    return { skipped: { path, reason: 'Folder exceeds the 500-file limit' } };

  const textError = await validateTextFile(source.file);
  if (textError) return { skipped: { path, reason: textError } };

  return {
    candidate: {
      path,
      file: source.file,
      size: source.file.size,
      selected: true,
    },
  };
}

async function validateTextFile(file: File): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.includes(0)) return 'Binary file';
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return null;
  } catch {
    return 'File is not valid UTF-8 text';
  }
}

export async function prepareProjectImport(
  files: ImportedFileContent[],
  siteId: string
): Promise<ImportSnapshot[]> {
  if (files.length === 0 || files.length > MAX_IMPORT_FILE_COUNT)
    throw new Error('The import exceeds the 500-file limit.');

  const seenPaths = new Set<string>();
  const totals = { contentBytes: 0, snapshotBytes: 0, compressedBytes: 0 };
  const result: ImportSnapshot[] = [];

  for (const file of files) {
    const prepared = await createImportSnapshot(file, siteId);
    const pathKey = prepared.path.toLocaleLowerCase('en-US');
    if (seenPaths.has(pathKey))
      throw new Error('The import contains duplicate paths.');
    seenPaths.add(pathKey);
    totals.contentBytes += prepared.contentBytes;
    totals.snapshotBytes += prepared.snapshotBytes;
    totals.compressedBytes += prepared.compressedBytes;
    validateProjectImportTotals(totals);
    result.push(prepared.file);
  }

  return result;
}

async function createImportSnapshot(
  file: ImportedFileContent,
  siteId: string
): Promise<{
  file: ImportSnapshot;
  path: string;
  contentBytes: number;
  snapshotBytes: number;
  compressedBytes: number;
}> {
  const path = normalizeImportPath(file.path);
  const encoder = new TextEncoder();
  const contentBytes = encoder.encode(file.content).byteLength;
  if (contentBytes > MAX_IMPORT_FILE_BYTES || file.content.includes('\0'))
    throw new Error(
      'A selected file is invalid or exceeds the 64 KB file limit.'
    );

  const snapshot = CrdtDocument.fromText(siteId, file.content).toSnapshot();
  const compressed = await compressCrdtSnapshot(snapshot);
  const { snapshotBytes, compressedBytes } = compressed;
  if (compressedBytes > MAX_IMPORT_FILE_COMPRESSED_BYTES)
    throw new Error(
      'A compressed file snapshot exceeds the 1 MB per-file limit.'
    );
  return {
    path,
    contentBytes,
    snapshotBytes,
    compressedBytes,
    file: {
      path,
      id: crypto.randomUUID().replaceAll('-', ''),
      compressedSnapshot: compressed.value,
    },
  };
}

function validateProjectImportTotals(totals: {
  contentBytes: number;
  snapshotBytes: number;
  compressedBytes: number;
}): void {
  if (totals.contentBytes > MAX_IMPORT_TOTAL_BYTES)
    throw new Error(
      `Selected source files total ${(totals.contentBytes / (1024 * 1024)).toFixed(2)} MB. The import limit is 1 MB.`
    );
  if (totals.snapshotBytes > MAX_IMPORT_TOTAL_SNAPSHOT_BYTES)
    throw new Error(
      `CRDT snapshots total ${(totals.snapshotBytes / (1024 * 1024)).toFixed(1)} MB. The import limit is 192 MB.`
    );
  if (totals.compressedBytes > MAX_IMPORT_TOTAL_COMPRESSED_BYTES)
    throw new Error(
      `Compressed snapshots total ${(totals.compressedBytes / (1024 * 1024)).toFixed(1)} MB. The network limit is 10 MB.`
    );
}

export async function saveProjectFilesToFolder(
  files: ImportedFileContent[],
  onProgress?: (completedFiles: number) => void,
  signal?: AbortSignal
): Promise<boolean> {
  throwIfSaveAborted(signal);
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) return false;

  const root = await picker.call(window, { mode: 'readwrite' });
  const writableRoot = root;

  if (
    writableRoot.requestPermission &&
    (await writableRoot.requestPermission({ mode: 'readwrite' })) !== 'granted'
  ) {
    throw new Error('Write access to the selected folder was not granted.');
  }

  for (const [index, file] of files.entries()) {
    throwIfSaveAborted(signal);
    const path = normalizeImportPath(file.path);
    const segments = path.split('/');
    let directory = writableRoot;
    for (const segment of segments.slice(0, -1)) {
      if (!directory.getDirectoryHandle)
        throw new Error('Folder writing is unavailable in this browser.');
      directory = await directory.getDirectoryHandle(segment, { create: true });
    }
    if (!directory.getFileHandle)
      throw new Error('Folder writing is unavailable in this browser.');
    const handle = await directory.getFileHandle(segments.at(-1)!, {
      create: true,
    });
    const writable = await handle.createWritable();
    try {
      await writable.write(file.content);
      if (signal?.aborted) {
        await writable.abort?.();
        throw new DOMException('Saving was cancelled.', 'AbortError');
      }
      await writable.close();
    } catch (reason) {
      if (signal?.aborted) {
        try {
          await writable.abort?.();
        } catch {
          // Ignore abort cleanup failures
        }
        throw new DOMException('Saving was cancelled.', 'AbortError');
      }
      throw reason;
    }
    onProgress?.(index + 1);
  }
  return true;
}

function throwIfSaveAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException('Saving was cancelled.', 'AbortError');
}

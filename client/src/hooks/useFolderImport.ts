import { useCallback, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  inspectFolderFiles,
  pickFolderFiles,
  readSelectedImportFiles,
  supportsDirectoryPicker,
  MAX_IMPORT_TOTAL_BYTES,
} from '../import/folderImport';
import type {
  FolderFileSource,
  ImportFileCandidate,
  ImportedFileContent,
} from '../import/folderImport';
import { userFacingError } from '../utils/userFacingError';

export interface UseFolderImportOptions {
  onImport: (files: ImportedFileContent[]) => Promise<void>;
  onClose: () => void;
}

export function useFolderImport({ onImport, onClose }: UseFolderImportOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [candidates, setCandidates] = useState<ImportFileCandidate[]>([]);
  const [skipped, setSkipped] = useState<
    Array<{ path: string; reason: string }>
  >([]);
  const [error, setError] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const inspect = useCallback(
    async (
      files: FolderFileSource[],
      initiallySkipped: Array<{ path: string; reason: string }> = []
    ) => {
      setIsReading(true);
      setError('');
      try {
        const result = await inspectFolderFiles(files, initiallySkipped);
        setCandidates(result.candidates);
        setSkipped(result.skipped);
      } catch {
        setError('Could not inspect this folder. Try selecting it again.');
      } finally {
        setIsReading(false);
      }
    },
    []
  );

  const selectFolder = useCallback(async () => {
    if (!supportsDirectoryPicker()) {
      inputRef.current?.click();
      return;
    }
    try {
      const result = await pickFolderFiles();
      await inspect(result.files, result.skipped);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError')
        return;
      setError(userFacingError(reason, 'Could not read this folder.'));
    }
  }, [inspect]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files: FolderFileSource[] = Array.from(
        event.currentTarget.files ?? []
      ).map((file) => {
        const relativePath = file.webkitRelativePath || file.name;
        const rootSeparator = relativePath.indexOf('/');
        return {
          path:
            rootSeparator >= 0
              ? relativePath.slice(rootSeparator + 1)
              : relativePath,
          file,
        };
      });
      void inspect(files);
      event.currentTarget.value = '';
    },
    [inspect]
  );

  const toggleCandidate = useCallback((path: string, selected: boolean) => {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.path === path ? { ...candidate, selected } : candidate
      )
    );
  }, []);

  const importSelected = useCallback(async () => {
    if (isImporting || isReading) return;
    setIsImporting(true);
    setError('');
    try {
      await onImport(await readSelectedImportFiles(candidates));
      onClose();
    } catch (reason) {
      setError(userFacingError(reason, 'Could not import these files.'));
    } finally {
      setIsImporting(false);
    }
  }, [candidates, isImporting, isReading, onClose, onImport]);

  const selected = candidates.filter((candidate) => candidate.selected);
  const selectedBytes = selected.reduce(
    (total, candidate) => total + candidate.size,
    0
  );

  return {
    inputRef,
    candidates,
    skipped,
    error,
    isReading,
    isImporting,
    selectedCount: selected.length,
    selectedBytes,
    canImport:
      selected.length > 0 &&
      !isReading &&
      !isImporting &&
      selectedBytes <= MAX_IMPORT_TOTAL_BYTES,
    selectFolder,
    handleInputChange,
    toggleCandidate,
    importSelected,
  };
}

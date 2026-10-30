import { useCallback, useState } from 'react';
import { useAppActivity } from '../components/shared/useAppActivity';
import {
  pickAndImportLocalFile,
  pickLocalFolderForImport,
  readSelectedImportFiles,
} from '../import/folderImport';
import type {
  ImportedFileContent,
  LocalFolderImportPreview,
} from '../import/folderImport';
import { userFacingError } from '../utils/userFacingError';

interface UseLocalProjectImportOptions {
  importProjectFiles: (
    files: ImportedFileContent[],
    folderName?: string,
    replaceWorkspace?: boolean,
    onProgress?: (completedFiles: number) => void,
    signal?: AbortSignal
  ) => Promise<void>;
  setPreviewOpen: (open: boolean) => void;
  showMessage: (message: string) => void;
}

export function useLocalProjectImport({
  importProjectFiles,
  setPreviewOpen,
  showMessage,
}: UseLocalProjectImportOptions) {
  const { runActivity } = useAppActivity();
  const [folderPreview, setFolderPreview] =
    useState<LocalFolderImportPreview | null>(null);
  const openLocalFile = useCallback(async () => {
    try {
      setPreviewOpen(false);
      await runActivity('Importing file…', () =>
        pickAndImportLocalFile(importProjectFiles)
      );
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError')
        return;
      showMessage(userFacingError(reason, 'Could not import file.'));
    }
  }, [importProjectFiles, runActivity, setPreviewOpen, showMessage]);

  const openLocalFolder = useCallback(async () => {
    setPreviewOpen(false);
    try {
      setFolderPreview(
        await runActivity('Loading folder…', () => pickLocalFolderForImport())
      );
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError')
        return;
      showMessage(userFacingError(reason, 'Could not import folder.'));
    }
  }, [runActivity, setPreviewOpen, showMessage]);

  const importLocalFolder = useCallback(
    async (
      paths: string[],
      onProgress: (completedFiles: number) => void,
      signal: AbortSignal
    ) => {
      if (!folderPreview) throw new Error('Choose a folder to import again.');
      await runActivity('Importing folder…', async () => {
        const selectedPaths = new Set(paths);
        const selected = folderPreview.candidates.filter((candidate) =>
          selectedPaths.has(candidate.path)
        );
        const files = await readSelectedImportFiles(selected);
        await importProjectFiles(
          files,
          folderPreview.folderName,
          true,
          onProgress,
          signal
        );
      });
    },
    [folderPreview, importProjectFiles, runActivity]
  );

  const closeFolderPreview = useCallback(() => setFolderPreview(null), []);

  return {
    openLocalFile,
    openLocalFolder,
    folderPreview,
    importLocalFolder,
    closeFolderPreview,
  };
}

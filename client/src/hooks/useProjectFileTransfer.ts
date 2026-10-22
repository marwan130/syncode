import { useCallback } from 'react';
import type { RefObject } from 'react';
import type {
  RoomEntry,
  SignalRCrdtProvider,
} from '../providers/SignalRCrdtProvider';
import {
  downloadProjectFiles,
  saveProjectFilesToFolder,
} from '../import/folderImport';
import type { ImportedFileContent } from '../import/folderImport';
import { getEntryPath } from '../components/editor/editorLayoutStorage';
import { userFacingError } from '../utils/userFacingError';
import { useAppFeedback } from '../components/shared/useAppFeedback';

export interface UseProjectFileTransferOptions {
  entries: RoomEntry[];
  providerRef: RefObject<SignalRCrdtProvider | null>;
}

export function useProjectFileTransfer({
  entries,
  providerRef,
}: UseProjectFileTransferOptions) {
  const { showMessage } = useAppFeedback();
  const importProjectFiles = useCallback(
    async (files: ImportedFileContent[]) => {
      const provider = providerRef.current;
      if (!provider)
        throw new Error('Connect to the room before importing a folder.');
      await provider.importProjectFiles(files);
    },
    [providerRef]
  );

  const saveProjectFiles = useCallback(async () => {
    const files = entries
      .filter((entry) => !entry.isFolder)
      .map((entry) => ({
        path: getEntryPath(entry, entries),
        content: providerRef.current?.getFileContent(entry.id) ?? '',
      }));
    if (files.length === 0) return;

    try {
      const savedToFolder = await saveProjectFilesToFolder(files);
      if (!savedToFolder) downloadProjectFiles(files);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      await showMessage(
        userFacingError(error, 'Could not save project files.')
      );
    }
  }, [entries, providerRef, showMessage]);

  return { importProjectFiles, saveProjectFiles };
}

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
import type { GithubRepositoryBaseline } from '../github/githubTypes';
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

  const importGithubRepository = useCallback(
    async (
      files: ImportedFileContent[],
      baseline: GithubRepositoryBaseline
    ) => {
      const provider = providerRef.current;
      if (!provider)
        throw new Error('Connect to the room before importing a repository.');
      await provider.importProjectFiles(files, baseline);
    },
    [providerRef]
  );

  const saveProjectFiles = useCallback(async () => {
    const files = getProjectFiles(entries, providerRef);
    await saveProjectFilesToDestination(files, showMessage);
  }, [entries, providerRef, showMessage]);

  return { importProjectFiles, importGithubRepository, saveProjectFiles };
}

function getProjectFiles(
  entries: RoomEntry[],
  providerRef: RefObject<SignalRCrdtProvider | null>
): ImportedFileContent[] {
  return entries
    .filter((entry) => !entry.isFolder)
    .map((entry) => ({
      path: getEntryPath(entry, entries),
      content: providerRef.current?.getFileContent(entry.id) ?? '',
    }));
}

async function saveOrDownloadProjectFiles(
  files: ImportedFileContent[]
): Promise<void> {
  const savedToFolder = await saveProjectFilesToFolder(files);
  if (!savedToFolder) downloadProjectFiles(files);
}

async function saveProjectFilesToDestination(
  files: ImportedFileContent[],
  showMessage: (message: string) => Promise<void>
): Promise<void> {
  if (files.length === 0) return;
  try {
    await saveOrDownloadProjectFiles(files);
  } catch (error) {
    await reportProjectFileSaveError(error, showMessage);
  }
}

async function reportProjectFileSaveError(
  error: unknown,
  showMessage: (message: string) => Promise<void>
): Promise<void> {
  if (isUserCancelledSave(error)) return;
  await showMessage(userFacingError(error, 'Could not save project files.'));
}

function isUserCancelledSave(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

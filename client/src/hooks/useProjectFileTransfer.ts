import { useCallback } from 'react';
import type { RefObject } from 'react';
import type {
  RoomEntry,
  SignalRCrdtProvider,
} from '../providers/SignalRCrdtProvider';
import type { ImportedFileContent } from '../import/folderImport';
import type { GithubRepositoryBaseline } from '../github/githubTypes';
import { getEntryPath } from '../components/editor/editorLayoutStorage';
import { useAppActivity } from '../components/shared/useAppActivity';

export interface UseProjectFileTransferOptions {
  entries: RoomEntry[];
  providerRef: RefObject<SignalRCrdtProvider | null>;
}

export function useProjectFileTransfer({
  entries,
  providerRef,
}: UseProjectFileTransferOptions) {
  const { runActivity } = useAppActivity();
  const getCurrentProjectFiles = useCallback(
    () => getProjectFiles(entries, providerRef),
    [entries, providerRef]
  );
  const importProjectFiles = useCallback(
    async (
      files: ImportedFileContent[],
      folderName?: string,
      replaceWorkspace = false,
      onProgress?: (completedFiles: number) => void,
      signal?: AbortSignal
    ) => {
      const provider = providerRef.current;
      if (!provider)
        throw new Error('Connect to the room before importing a folder.');
      await runActivity('Importing project files…', () =>
        provider.importProjectFiles(
          files,
          null,
          folderName,
          replaceWorkspace,
          onProgress,
          signal
        )
      );
    },
    [providerRef, runActivity]
  );

  const importGithubRepository = useCallback(
    async (
      files: ImportedFileContent[],
      baseline: GithubRepositoryBaseline,
      onProgress?: (completedFiles: number) => void
    ) => {
      const provider = providerRef.current;
      if (!provider)
        throw new Error('Connect to the room before importing a repository.');
      await runActivity('Importing repository…', () =>
        provider.importProjectFiles(
          files,
          baseline,
          baseline.name,
          true,
          onProgress
        )
      );
    },
    [providerRef, runActivity]
  );

  return {
    importProjectFiles,
    importGithubRepository,
    getCurrentProjectFiles,
  };
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

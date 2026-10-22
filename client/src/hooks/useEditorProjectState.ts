import type { RefObject } from 'react';
import type {
  ConnectionStatus,
  SignalRCrdtProvider,
} from '../providers/SignalRCrdtProvider';
import { getEntryPath } from '../components/editor/editorLayoutStorage';
import { useEditorFileState } from './useEditorFileState';
import { useExplorerActions } from './useExplorerActions';
import { useProjectFileTransfer } from './useProjectFileTransfer';

export interface UseEditorProjectStateOptions {
  roomId: string;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
}

export function useEditorProjectState({
  roomId,
  providerRef,
  status,
}: UseEditorProjectStateOptions) {
  const fileState = useEditorFileState({ roomId, providerRef, status });
  const explorerActions = useExplorerActions({
    providerRef,
    runFileAction: fileState.runFileAction,
  });
  const transfer = useProjectFileTransfer({
    entries: fileState.entries,
    providerRef,
  });
  const activeFile = fileState.entries.find(
    (entry) => entry.id === fileState.activeFileId && !entry.isFolder
  );
  const splitFile = fileState.splitFileId
    ? fileState.entries.find(
        (entry) => entry.id === fileState.splitFileId && !entry.isFolder
      )
    : undefined;

  return {
    ...fileState,
    activeFile,
    activeFilePath: activeFile
      ? getEntryPath(activeFile, fileState.entries)
      : '',
    explorerActions,
    splitFile,
    splitFilePath: splitFile ? getEntryPath(splitFile, fileState.entries) : '',
    transfer,
  };
}

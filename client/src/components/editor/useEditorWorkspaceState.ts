import { useState } from 'react';
import type { RefObject } from 'react';
import { useEditorProjectState } from '../../hooks/useEditorProjectState';
import type {
  ConnectionStatus,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';
import { getStoredPreviewWidth } from './editorLayoutStorage';

export function useEditorWorkspaceState(
  roomId: string,
  providerRef: RefObject<SignalRCrdtProvider | null>,
  status: ConnectionStatus
) {
  const project = useEditorProjectState({ roomId, providerRef, status });
  const { entries } = project;
  const [previewWidth, setPreviewWidth] = useState(getStoredPreviewWidth);
  const [isPreviewOpen, setPreviewOpen] = useState(true);
  const canSplitWorkspace = entries.some((entry) => !entry.isFolder);

  return {
    ...project,
    canSplitWorkspace,
    previewWidth,
    setPreviewWidth,
    isPreviewOpen,
    setPreviewOpen,
  };
}

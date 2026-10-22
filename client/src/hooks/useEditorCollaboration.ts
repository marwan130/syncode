import type { RefObject } from 'react';
import type * as monaco from 'monaco-editor';
import type {
  ConnectionStatus,
  RoomEntry,
  SignalRCrdtProvider,
} from '../providers/SignalRCrdtProvider';
import { useAwareness } from './useAwareness';
import { useEditorCrdtBindings } from './useEditorCrdtBindings';

export interface UseEditorCollaborationOptions {
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  localName: string;
  localColor: string;
  entries: RoomEntry[];
  openFileIds: string[];
  primaryEditor: monaco.editor.IStandaloneCodeEditor | null;
  secondaryEditor: monaco.editor.IStandaloneCodeEditor | null;
  activeFileId: string;
  splitFileId: string | null;
  monacoApi: typeof monaco | null;
}

export function useEditorCollaboration({
  providerRef,
  status,
  localName,
  localColor,
  entries,
  openFileIds,
  primaryEditor,
  secondaryEditor,
  activeFileId,
  splitFileId,
  monacoApi,
}: UseEditorCollaborationOptions) {
  const awareness = useAwareness({
    providerRef,
    status,
    localName,
    localColor,
  });

  useEditorCrdtBindings({
    monacoApi,
    entries,
    openFileIds,
    providerRef,
    status,
    primaryEditor,
    secondaryEditor,
    activeFileId,
    splitFileId,
    broadcastCursor: awareness.broadcastCursor,
  });

  return {
    ...awareness,
    isEditLocked: awareness.localParticipant?.isLocked === true,
  };
}

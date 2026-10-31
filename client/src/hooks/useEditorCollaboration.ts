import type { RefObject } from 'react';
import type * as monaco from 'monaco-editor';
import type {
  ConnectionStatus,
  RoomEntry,
  SignalRCrdtProvider,
} from '../providers/SignalRCrdtProvider';
import { useAwareness } from './useAwareness';
import { useEditorCrdtBindings } from './useEditorCrdtBindings';
import type { EditorGroupState } from '../components/editor/editorGroups';

export interface UseEditorCollaborationOptions {
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  localName: string;
  localColor: string;
  entries: RoomEntry[];
  editorGroups: EditorGroupState[];
  editors: Map<string, monaco.editor.IStandaloneCodeEditor>;
  monacoApi: typeof monaco | null;
}

export function useEditorCollaboration({
  providerRef,
  status,
  localName,
  localColor,
  entries,
  editorGroups,
  editors,
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
    editorGroups,
    providerRef,
    status,
    editors,
    broadcastCursor: awareness.broadcastCursor,
  });

  return {
    ...awareness,
    isEditLocked: awareness.localParticipant?.isLocked === true,
  };
}

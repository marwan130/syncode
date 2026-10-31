import type { Dispatch, SetStateAction } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useDebouncedPreview } from '../../hooks/useDebouncedPreview';
import { useFileDiagnostics } from '../../hooks/useFileDiagnostics';
import { useEditorCollaboration } from '../../hooks/useEditorCollaboration';
import { useRoomParticipantActions } from '../../hooks/useRoomParticipantActions';
import { useGithubRepository } from '../../github/useGithubRepository';
import type { ConnectionStatus } from '../../providers/SignalRCrdtProvider';
import type { useEditorRoomSession } from './useEditorRoomSession';
import type { useEditorWorkspaceState } from './useEditorWorkspaceState';
import { isPreviewLanguage, type LanguageMode } from './languageModes';

export function useEditorCollaborationState({
  providerRef,
  roomId,
  status,
  displayName,
  localColor,
  workspace,
  editors,
  monacoApi,
  accessKey,
  setPreviewOpen,
  language,
}: {
  providerRef: ReturnType<typeof useEditorRoomSession>['providerRef'];
  roomId: string;
  status: ConnectionStatus;
  displayName: string;
  localColor: string;
  workspace: ReturnType<typeof useEditorWorkspaceState>;
  editors: Map<string, monaco.editor.IStandaloneCodeEditor>;
  monacoApi: Monaco | null;
  accessKey: string;
  setPreviewOpen: Dispatch<SetStateAction<boolean>>;
  language: LanguageMode;
}) {
  const participants = useEditorCollaboration({
    providerRef,
    status,
    localName: displayName || 'Anonymous',
    localColor,
    entries: workspace.entries,
    editorGroups: workspace.editorGroups,
    editors,
    monacoApi,
  });
  const participantActions = useRoomParticipantActions(providerRef);
  const { explorer: githubExplorer } = useGithubRepository(
    providerRef,
    workspace.entries,
    status,
    {
      roomId,
      accessKey,
      canImport: Boolean(participants.localParticipant?.isAdmin),
      closePreview: () => setPreviewOpen(false),
      importFiles: workspace.transfer.importGithubRepository,
    }
  );
  const previewSource = useDebouncedPreview({
    providerRef,
    status,
    enabled: Boolean(workspace.activeFile && isPreviewLanguage(language)),
    activeFileId: workspace.activeFileId,
  });
  const fileDiagnostics = useFileDiagnostics({
    monacoApi,
    entries: workspace.entries,
  });

  return {
    ...participants,
    participantActions,
    githubExplorer,
    previewSource,
    fileDiagnostics: fileDiagnostics.byFile,
    problems: fileDiagnostics.problems,
  };
}

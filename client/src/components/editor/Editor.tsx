import { useState } from 'react';
import type { Monaco, OnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useAutocompletePreference } from '../../hooks/useAutocompletePreference';
import {
  isPreviewLanguage,
  languageForFileName,
  type LanguageMode,
} from './languageModes';
import { EditorRoomLayout } from './EditorRoomLayout';
import { configureMonacoEditor } from '../../utils/configureMonacoEditor';
import { useEditorRoomSession } from './useEditorRoomSession';
import { useEditorWorkspaceState } from './useEditorWorkspaceState';
import { useEditorPanelState } from './useEditorPanelState';
import { useEditorActivityState } from './useEditorActivityState';
import { useEditorCollaborationState } from './useEditorCollaborationState';
import { useRoomJoinRequests } from '../../hooks/useRoomJoinRequests';

export interface EditorProps {
  roomId?: string;
  accessKey: string;
}

function EditorComponent({ roomId: propRoomId, accessKey }: EditorProps) {
  const {
    roomId,
    identity: roomIdentity,
    account,
    ...connection
  } = useEditorRoomSession(propRoomId, accessKey);
  const { displayName, localColor, participantId, setLocalColor } =
    roomIdentity;
  const [monacoApi, setMonacoApi] = useState<Monaco | null>(null);
  const [autocompleteEnabled, setAutocompleteEnabled] =
    useAutocompletePreference();
  const [monacoEditor, setMonacoEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [splitMonacoEditor, setSplitMonacoEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const { status, connectionError, providerRef } = connection;
  const joinRequests = useRoomJoinRequests(providerRef, status);
  const workspace = useEditorWorkspaceState(roomId, providerRef, status);
  const panels = useEditorPanelState(workspace);
  const {
    entries,
    activeFileId,
    openFileIds,
    splitFileId,
    isSplitWorkspaceOpen,
    splitWidth,
    setSplitWidth,
    openFile,
    closeFileTab,
    handleDropFile,
    createEntry,
    activeFile,
    activeFilePath,
    explorerActions,
    splitFile,
    splitFilePath,
    transfer,
    canSplitWorkspace,
    splitWorkspace,
    previewWidth,
    setPreviewWidth,
    isPreviewOpen,
    setPreviewOpen,
  } = workspace;
  const {
    isExplorerOpen,
    setExplorerOpen,
    activeSidebarView,
    setActiveSidebarView,
    explorerWidth,
    setExplorerWidth,
    chatWidth,
    setChatOpen,
    isChatOpen,
    setChatWidth,
    terminalHeight,
    setTerminalHeight,
    isShortcutGuideOpen,
    setShortcutGuideOpen,
    newTerminalRequest,
    startBashOnTerminalOpen,
    terminalPanelMounted,
    isTerminalOpen,
    actions: panelActions,
  } = panels;
  const language: LanguageMode = languageForFileName(activeFilePath);
  const activity = useEditorActivityState({
    providerRef,
    status,
    activeFile,
    activeFilePath,
    language,
    monacoEditor,
    monacoApi,
    canSplitWorkspace,
    splitWorkspace,
    panels,
  });
  const {
    canRunCode,
    runDisabledReason,
    messages,
    sendMessage,
    execution,
    handleRunCode,
  } = activity;
  const {
    chunks: executionChunks,
    outputRevision: executionOutputRevision,
    isRunning: isExecutionRunning,
    message: executionMessage,
    jobId: executionJobId,
  } = execution;
  const collaboration = useEditorCollaborationState({
    providerRef,
    roomId,
    status,
    displayName,
    localColor,
    workspace,
    monacoEditor,
    splitMonacoEditor,
    monacoApi,
    accessKey,
    setPreviewOpen,
    language,
  });
  const {
    peers,
    localParticipant,
    isEditLocked,
    participantActions,
    githubExplorer,
    previewSource,
    fileDiagnostics,
  } = collaboration;

  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    configureMonacoEditor(monacoInstance);
    setMonacoEditor(editor);
    setMonacoApi(monacoInstance);
  };

  return (
    <EditorRoomLayout
      roomHeader={{
        roomId,
        participantId,
        localName: displayName,
        localColor,
        localAvatarUrl: account?.avatarUrl,
        onJoinProfile: roomIdentity.updateProfile,
        onColorChange: setLocalColor,
        peers,
        isAdmin: Boolean(localParticipant?.isAdmin),
        onToggleParticipantLock: participantActions.toggleEditLock,
        onSetParticipantAdmin: participantActions.setAdminRole,
        onKickParticipant: participantActions.kickParticipant,
        joinRequests: joinRequests.requests,
        onApproveJoinRequest: joinRequests.approve,
        onRejectJoinRequest: joinRequests.reject,
        monaco: monacoApi,
        autocompleteEnabled,
        onAutocompleteChange: setAutocompleteEnabled,
        showPreviewButton: isPreviewLanguage(language),
        onShowPreview: panelActions.togglePreview,
      }}
      connectionError={connectionError}
      fileExplorer={{
        isOpen: isExplorerOpen,
        width: explorerWidth,
        entries,
        activeFileId,
        canEdit: status === 'connected' && !isEditLocked,
        fileDiagnostics,
        onWidthChange: setExplorerWidth,
        onClose: () => setExplorerOpen(false),
        actions: {
          onSelect: openFile,
          onCreateEntry: createEntry,
          onRename: explorerActions.renameEntry,
          onDelete: explorerActions.deleteEntry,
          onMove: explorerActions.moveEntry,
        },
        projectActions: {
          canImportFolder: Boolean(localParticipant?.isAdmin),
          onImportFolder: async (files) => {
            setPreviewOpen(false);
            await transfer.importProjectFiles(files);
          },
          onSaveProject: transfer.saveProjectFiles,
        },
      }}
      chat={{
        isOpen: isChatOpen,
        width: chatWidth,
        messages,
        status,
        onWidthChange: setChatWidth,
        onClose: () => setChatOpen(false),
        onSendMessage: sendMessage,
      }}
      workspace={{
        entries,
        activeFileId,
        activeFile,
        activeFilePath,
        openFileIds,
        canSplitWorkspace,
        fileDiagnostics,
        splitFileId,
        splitFile,
        splitFilePath,
        isSplitWorkspaceOpen,
        splitWidth,
        status,
        isLocked: isEditLocked,
        autocompleteEnabled,
        language,
        peers,
        providerRef,
        monacoEditor,
        onMountPrimary: handleEditorMount,
        onMountSecondary: setSplitMonacoEditor,
        onOpenFile: openFile,
        onCloseFileTab: closeFileTab,
        onSplitWorkspace: splitWorkspace,
        onCloseSplitGroup: panelActions.closeSplitGroup,
        onSplitWidthChange: setSplitWidth,
        onSetActiveGroup: workspace.setActiveEditorGroup,
        onDropFile: handleDropFile,
      }}
      preview={{
        isOpen: isPreviewOpen,
        width: previewWidth,
        hasActiveFile: Boolean(activeFile),
        language,
        project: previewSource,
        monaco: monacoApi,
        editor: monacoEditor,
        onWidthChange: setPreviewWidth,
        onClose: () => setPreviewOpen(false),
      }}
      terminal={{
        isOpen: isTerminalOpen,
        hasOpened: terminalPanelMounted,
        height: terminalHeight,
        chunks: executionChunks,
        outputRevision: executionOutputRevision,
        message: executionMessage,
        jobId: executionJobId,
        providerRef,
        status,
        newTerminalRequest,
        startBashOnMount: startBashOnTerminalOpen,
        onHeightChange: setTerminalHeight,
        onClose: panelActions.closeTerminal,
        onEmpty: panelActions.closeTerminal,
      }}
      isShortcutGuideOpen={isShortcutGuideOpen}
      setShortcutGuideOpen={setShortcutGuideOpen}
      activeSidebarView={activeSidebarView}
      onSelectSidebarView={(view) =>
        setActiveSidebarView((current) => (current === view ? null : view))
      }
      onCloseSidebarView={() => setActiveSidebarView(null)}
      sidebarWidth={explorerWidth}
      onSidebarWidthChange={setExplorerWidth}
      onToggleChat={panelActions.toggleChat}
      activity={{
        entries,
        activeFileId,
        providerRef,
        github: githubExplorer,
        canRunCode,
        runDisabledReason,
        isRunningCode: isExecutionRunning,
        onOpenFile: (fileId, line) => {
          openFile(fileId);
          window.setTimeout(() => {
            if (!monacoEditor) return;
            monacoEditor.revealLineInCenter(line);
            monacoEditor.setPosition({ lineNumber: line, column: 1 });
            monacoEditor.focus();
          }, 50);
        },
        onRunCode: handleRunCode,
        onOpenTerminal: panelActions.openTerminal,
      }}
    />
  );
}

export default EditorComponent;

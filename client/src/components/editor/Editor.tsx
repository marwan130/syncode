import { useCallback, useEffect, useState } from 'react';
import type { Monaco, OnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useNavigate, useParams } from 'react-router-dom';
import { useCrdtSync } from '../../hooks/useCrdtSync';
import { useChat } from '../../hooks/useChat';
import { useDebouncedPreview } from '../../hooks/useDebouncedPreview';
import { useExecutionStream } from '../../hooks/useExecutionStream';
import { useFileDiagnostics } from '../../hooks/useFileDiagnostics';
import { useAutocompletePreference } from '../../hooks/useAutocompletePreference';
import { useEditorShortcuts } from '../../hooks/useEditorShortcuts';
import { useExecutionEligibility } from '../../hooks/useExecutionEligibility';
import { useEditorRunAction } from '../../hooks/useEditorRunAction';
import { useEditorCollaboration } from '../../hooks/useEditorCollaboration';
import { useEditorPanelActions } from '../../hooks/useEditorPanelActions';
import { useEditorRoomIdentity } from '../../hooks/useEditorRoomIdentity';
import { useRoomParticipantActions } from '../../hooks/useRoomParticipantActions';
import { useEditorProjectState } from '../../hooks/useEditorProjectState';
import {
  createSiteId,
  getStoredRoomCreatorToken,
} from '../../utils/userStorage';
import {
  isPreviewLanguage,
  languageForFileName,
  type LanguageMode,
} from './languageModes';
import {
  DEFAULT_CHAT_WIDTH,
  getStoredExplorerWidth,
  getStoredPreviewWidth,
  getStoredTerminalHeight,
} from './editorLayoutStorage';
import { EditorRoomLayout } from './EditorRoomLayout';
import { configureMonacoEditor } from '../../utils/configureMonacoEditor';
import { useGithubAuth } from '../../github/useGithubAuth';

export interface EditorProps {
  roomId?: string;
  accessKey: string;
}

function EditorComponent({ roomId: propRoomId, accessKey }: EditorProps) {
  const params = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const roomId = propRoomId ?? params.roomId ?? '';

  const roomIdentity = useEditorRoomIdentity(roomId);
  const { account } = useGithubAuth();
  const { displayName, localColor, participantId, setLocalColor } =
    roomIdentity;
  const [isExplorerOpen, setExplorerOpen] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(getStoredExplorerWidth);
  const [siteId] = useState(createSiteId);
  const [monacoApi, setMonacoApi] = useState<Monaco | null>(null);
  const [autocompleteEnabled, setAutocompleteEnabled] =
    useAutocompletePreference();
  const [monacoEditor, setMonacoEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [splitMonacoEditor, setSplitMonacoEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const roomCreatorToken = getStoredRoomCreatorToken(roomId);

  const { status, connectionError, wasKicked, providerRef } = useCrdtSync({
    siteId,
    roomId,
    accessKey,
    displayName: displayName || undefined,
    color: localColor,
    creatorToken: roomCreatorToken,
    enabled: Boolean(roomId && accessKey && displayName),
  });

  useEffect(() => {
    providerRef.current?.setLocalAvatarUrl(account?.avatarUrl);
  }, [account?.avatarUrl, providerRef]);

  useEffect(() => {
    if (wasKicked) navigate('/', { replace: true });
  }, [navigate, wasKicked]);

  const {
    entries,
    activeFileId,
    openFileIds,
    splitFileId,
    setSplitFileId,
    isSplitWorkspaceOpen,
    setSplitWorkspaceOpen,
    setActiveEditorGroup,
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
  } = useEditorProjectState({ roomId, providerRef, status });
  const canSplitWorkspace = entries.some((entry) => !entry.isFolder);

  useEffect(() => {
    if (canSplitWorkspace) return;
    setSplitWorkspaceOpen(false);
    setSplitFileId(null);
  }, [canSplitWorkspace, setSplitFileId, setSplitWorkspaceOpen]);

  const splitWorkspace = useCallback(() => {
    if (canSplitWorkspace) setSplitWorkspaceOpen(true);
  }, [canSplitWorkspace, setSplitWorkspaceOpen]);

  const participantActions = useRoomParticipantActions(providerRef);

  const language: LanguageMode = languageForFileName(activeFilePath);

  const { executionLanguage, canRunCode, runDisabledReason } =
    useExecutionEligibility({
      activeFile,
      activeFilePath,
      language,
      status,
      monacoEditor,
      monacoApi,
    });

  const [isChatOpen, setChatOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH);
  const [previewWidth, setPreviewWidth] = useState(getStoredPreviewWidth);
  const [isPreviewOpen, setPreviewOpen] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(getStoredTerminalHeight);
  const [isShortcutGuideOpen, setShortcutGuideOpen] = useState(false);
  const [newTerminalRequest, setNewTerminalRequest] = useState(0);
  const [startBashOnTerminalOpen, setStartBashOnTerminalOpen] = useState(false);
  const [terminalPanelMounted, setTerminalPanelMounted] = useState(false);

  const { messages, sendMessage } = useChat({ providerRef, status });
  const {
    chunks: executionChunks,
    outputRevision: executionOutputRevision,
    isRunning: isExecutionRunning,
    message: executionMessage,
    jobId: executionJobId,
    runCode,
  } = useExecutionStream({ providerRef, status });

  const [isTerminalOpen, setTerminalOpen] = useState(false);

  const revealTerminalPanel = useCallback(() => {
    setTerminalPanelMounted(true);
    setTerminalOpen(true);
  }, [setTerminalPanelMounted, setTerminalOpen]);
  const panelActions = useEditorPanelActions({
    isTerminalOpen,
    setExplorerOpen,
    setChatOpen,
    setPreviewOpen,
    setTerminalOpen,
    setNewTerminalRequest,
    setStartBashOnTerminalOpen,
    setSplitWorkspaceOpen,
    setSplitFileId,
    setActiveEditorGroup,
    revealTerminalPanel,
  });
  const handleRunCode = useEditorRunAction({
    canRunCode,
    isRunning: isExecutionRunning,
    executionLanguage,
    editor: monacoEditor,
    activeFile,
    activeFilePath,
    entries,
    providerRef,
    runCode,
    revealTerminalPanel,
    setStartBashOnTerminalOpen,
  });

  useEditorShortcuts({
    isShortcutGuideOpen,
    setShortcutGuideOpen,
    isTerminalOpen,
    canSplitWorkspace,
    onSplitWorkspace: splitWorkspace,
    setTerminalOpen,
    setPreviewOpen,
    setExplorerOpen,
    setChatOpen,
    setNewTerminalRequest,
    setStartBashOnTerminalOpen,
    revealTerminalPanel,
    language,
    canRunCode,
    executionLanguage,
    monacoEditor,
    handleRunCode,
  });

  const { peers, localParticipant, isEditLocked } = useEditorCollaboration({
    providerRef,
    status,
    localName: displayName || 'Anonymous',
    localColor,
    entries,
    openFileIds,
    primaryEditor: monacoEditor,
    secondaryEditor: splitMonacoEditor,
    activeFileId,
    splitFileId,
    monacoApi,
  });

  const previewSource = useDebouncedPreview({
    providerRef,
    status,
    enabled: Boolean(activeFile && isPreviewLanguage(language)),
    activeFileId,
  });

  const fileDiagnostics = useFileDiagnostics({
    monacoApi,
    entries,
  });

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
        status,
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
        editor: monacoEditor,
        monaco: monacoApi,
        autocompleteEnabled,
        onAutocompleteChange: setAutocompleteEnabled,
        explorerOpen: isExplorerOpen,
        onToggleExplorer: panelActions.toggleExplorer,
        isChatOpen,
        onToggleChat: panelActions.toggleChat,
        showPreviewButton: isPreviewLanguage(language),
        onShowPreview: panelActions.togglePreview,
        canRunCode,
        runDisabledReason,
        isRunningCode: isExecutionRunning,
        onOpenTerminal: panelActions.openTerminal,
        onRunCode: handleRunCode,
      }}
      connectionError={connectionError}
      fileExplorer={{
        isOpen: isExplorerOpen,
        width: explorerWidth,
        entries,
        activeFileId,
        canEdit: !isEditLocked,
        fileDiagnostics,
        onWidthChange: setExplorerWidth,
        onClose: () => setExplorerOpen(false),
        onSelect: openFile,
        onCreateEntry: createEntry,
        onRename: explorerActions.renameEntry,
        onDelete: explorerActions.deleteEntry,
        onMove: explorerActions.moveEntry,
        canImportFolder: Boolean(roomCreatorToken),
        onImportFolder: transfer.importProjectFiles,
        onSaveProject: transfer.saveProjectFiles,
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
        onSetActiveGroup: setActiveEditorGroup,
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
    />
  );
}

export default EditorComponent;

import { useCallback, useEffect, useState } from 'react';
import type { Monaco, OnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useNavigate, useParams } from 'react-router-dom';
import { useAwareness } from '../../hooks/useAwareness';
import { useCrdtSync } from '../../hooks/useCrdtSync';
import { useChat } from '../../hooks/useChat';
import { useDebouncedPreview } from '../../hooks/useDebouncedPreview';
import { useExecutionStream } from '../../hooks/useExecutionStream';
import { useFileDiagnostics } from '../../hooks/useFileDiagnostics';
import { useAutocompletePreference } from '../../hooks/useAutocompletePreference';
import { useEditorShortcuts } from '../../hooks/useEditorShortcuts';
import { useExecutionEligibility } from '../../hooks/useExecutionEligibility';
import { useEditorFileState } from '../../hooks/useEditorFileState';
import { useExplorerActions } from '../../hooks/useExplorerActions';
import { useEditorCrdtBindings } from '../../hooks/useEditorCrdtBindings';
import { userFacingError } from '../../utils/userFacingError';
import {
  createSiteId,
  getStoredColor,
  getStoredDisplayName,
  getOrCreateParticipantId,
} from '../../utils/userStorage';
import { RoomHeader } from '../room/RoomHeader';
import {
  isPreviewLanguage,
  languageForFileName,
  type LanguageMode,
} from './languageModes';
import {
  DEFAULT_CHAT_WIDTH,
  getEntryPath,
  getStoredExplorerWidth,
  getStoredPreviewWidth,
  getStoredTerminalHeight,
} from './editorLayoutStorage';
import { EditorWorkspace } from './EditorWorkspace';
import { FileExplorerPanel } from './FileExplorerPanel';
import { ChatPanelContainer } from './ChatPanelContainer';
import { PreviewPanel } from './PreviewPanel';
import { TerminalPanel } from './TerminalPanel';
import { ShortcutGuideDialog } from './ShortcutGuideDialog';
import { configureMonacoEditor } from '../../utils/configureMonacoEditor';

interface EditorProps {
  roomId?: string;
  accessKey: string;
}

function EditorComponent({ roomId: propRoomId, accessKey }: EditorProps) {
  const params = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const roomId = propRoomId ?? params.roomId ?? '';

  const [profile, setProfile] = useState(() => ({
    roomId,
    displayName: getStoredDisplayName(roomId) ?? '',
  }));
  const displayName =
    profile.roomId === roomId
      ? profile.displayName
      : (getStoredDisplayName(roomId) ?? '');
  const [participantId] = useState(() => getOrCreateParticipantId(roomId));
  const [localColor, setLocalColor] = useState(() =>
    getStoredColor(participantId)
  );
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

  const { status, connectionError, providerRef, evictedNewRoomId } =
    useCrdtSync({
      siteId,
      userId: participantId,
      roomId,
      accessKey,
      displayName: displayName || undefined,
      color: localColor,
      enabled: Boolean(roomId && accessKey && displayName),
    });

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
    runFileAction,
    createEntry,
  } = useEditorFileState({ roomId, providerRef, status });
  const explorerActions = useExplorerActions({ providerRef, runFileAction });

  const activeFile = entries.find(
    (entry) => entry.id === activeFileId && !entry.isFolder
  );
  const splitFile = splitFileId
    ? entries.find((entry) => entry.id === splitFileId && !entry.isFolder)
    : undefined;
  const activeFilePath = activeFile ? getEntryPath(activeFile, entries) : '';
  const splitFilePath = splitFile ? getEntryPath(splitFile, entries) : '';
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
  const handleRunCode = useCallback(() => {
    if (
      !canRunCode ||
      isExecutionRunning ||
      !executionLanguage ||
      !monacoEditor
    )
      return;
    setStartBashOnTerminalOpen(false);
    revealTerminalPanel();
    void runCode(executionLanguage, monacoEditor.getValue());
  }, [
    canRunCode,
    isExecutionRunning,
    setStartBashOnTerminalOpen,
    executionLanguage,
    monacoEditor,
    runCode,
    revealTerminalPanel,
  ]);

  useEditorShortcuts({
    isShortcutGuideOpen,
    setShortcutGuideOpen,
    isTerminalOpen,
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

  useEffect(() => {
    if (evictedNewRoomId)
      navigate(`/room/${evictedNewRoomId}`, { replace: true });
  }, [evictedNewRoomId, navigate]);

  const { peers, localParticipant, broadcastCursor } = useAwareness({
    providerRef,
    status,
    localName: displayName || 'Anonymous',
    localColor,
  });
  const isEditLocked = localParticipant?.isLocked === true;

  useEditorCrdtBindings({
    monacoApi,
    entries,
    openFileIds,
    providerRef,
    status,
    primaryEditor: monacoEditor,
    secondaryEditor: splitMonacoEditor,
    activeFileId,
    splitFileId,
    broadcastCursor,
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
    <div className="room-workspace">
      <RoomHeader
        roomId={roomId}
        participantId={participantId}
        status={status}
        localName={displayName}
        localColor={localColor}
        onJoinProfile={({ displayName: name, color }) => {
          setProfile({ roomId, displayName: name });
          setLocalColor(color);
        }}
        onColorChange={setLocalColor}
        peers={peers}
        isAdmin={Boolean(localParticipant?.isAdmin)}
        onToggleParticipantLock={(connectionId) => {
          return (
            providerRef.current
              ?.toggleParticipantEditLock(connectionId)
              .catch((error: unknown) => {
                window.alert(
                  userFacingError(
                    error,
                    'Could not update editing access. Try again.'
                  )
                );
              }) ?? Promise.resolve()
          );
        }}
        onSetParticipantAdmin={(connectionId, nextIsAdmin) => {
          return (
            providerRef.current
              ?.setParticipantAdmin(connectionId, nextIsAdmin)
              .catch((error: unknown) => {
                window.alert(
                  userFacingError(
                    error,
                    'Could not update the admin role. Try again.'
                  )
                );
              }) ?? Promise.resolve()
          );
        }}
        editor={monacoEditor}
        monaco={monacoApi}
        autocompleteEnabled={autocompleteEnabled}
        onAutocompleteChange={setAutocompleteEnabled}
        explorerOpen={isExplorerOpen}
        onToggleExplorer={() => setExplorerOpen((open) => !open)}
        isChatOpen={isChatOpen}
        onToggleChat={() => setChatOpen((open) => !open)}
        showPreviewButton={isPreviewLanguage(language)}
        onShowPreview={() => setPreviewOpen((open) => !open)}
        canRunCode={canRunCode}
        runDisabledReason={runDisabledReason}
        isRunningCode={isExecutionRunning}
        onOpenTerminal={() => {
          if (isTerminalOpen) setNewTerminalRequest((value) => value + 1);
          else setStartBashOnTerminalOpen(true);
          revealTerminalPanel();
        }}
        onRunCode={handleRunCode}
      />

      {connectionError && (
        <div className="room-connection-error" role="alert">
          {connectionError}
        </div>
      )}

      <div className="room-main">
        <FileExplorerPanel
          isOpen={isExplorerOpen}
          width={explorerWidth}
          entries={entries}
          activeFileId={activeFileId}
          canEdit={!isEditLocked}
          fileDiagnostics={fileDiagnostics}
          onWidthChange={setExplorerWidth}
          onClose={() => setExplorerOpen(false)}
          onSelect={openFile}
          onCreateEntry={(parentId, name, isFolder) =>
            createEntry(parentId, name, isFolder)
          }
          onRename={explorerActions.renameEntry}
          onDelete={explorerActions.deleteEntry}
          onMove={explorerActions.moveEntry}
        />

        <ChatPanelContainer
          isOpen={isChatOpen}
          width={chatWidth}
          messages={messages}
          status={status}
          onWidthChange={setChatWidth}
          onClose={() => setChatOpen(false)}
          onSendMessage={sendMessage}
        />

        <section
          className="workbench-main-column"
          aria-label="Editor and terminal area"
        >
          <div
            className={`room-editor${isPreviewLanguage(language) ? ' has-live-preview' : ''}`}
          >
            <EditorWorkspace
              entries={entries}
              activeFileId={activeFileId}
              activeFile={activeFile}
              activeFilePath={activeFilePath}
              openFileIds={openFileIds}
              fileDiagnostics={fileDiagnostics}
              splitFileId={splitFileId}
              splitFile={splitFile}
              splitFilePath={splitFilePath}
              isSplitWorkspaceOpen={isSplitWorkspaceOpen}
              splitWidth={splitWidth}
              status={status}
              isLocked={isEditLocked}
              autocompleteEnabled={autocompleteEnabled}
              language={language}
              peers={peers}
              providerRef={providerRef}
              monacoEditor={monacoEditor}
              onMountPrimary={handleEditorMount}
              onMountSecondary={(editor) => setSplitMonacoEditor(editor)}
              onOpenFile={openFile}
              onCloseFileTab={closeFileTab}
              onSplitWorkspace={() => setSplitWorkspaceOpen(true)}
              onCloseSplitGroup={() => {
                setSplitWorkspaceOpen(false);
                setSplitFileId(null);
                setActiveEditorGroup('primary');
              }}
              onSplitWidthChange={setSplitWidth}
              onSetActiveGroup={setActiveEditorGroup}
              onDropFile={handleDropFile}
            />

            <PreviewPanel
              isOpen={isPreviewOpen}
              width={previewWidth}
              hasActiveFile={Boolean(activeFile)}
              language={language}
              project={previewSource}
              monaco={monacoApi}
              editor={monacoEditor}
              onWidthChange={setPreviewWidth}
              onClose={() => setPreviewOpen(false)}
            />
          </div>

          <TerminalPanel
            isOpen={isTerminalOpen}
            hasOpened={terminalPanelMounted}
            height={terminalHeight}
            chunks={executionChunks}
            outputRevision={executionOutputRevision}
            message={executionMessage}
            jobId={executionJobId}
            isRunning={isExecutionRunning}
            providerRef={providerRef}
            status={status}
            newTerminalRequest={newTerminalRequest}
            startBashOnMount={startBashOnTerminalOpen}
            onHeightChange={setTerminalHeight}
            onClose={() => {
              setStartBashOnTerminalOpen(false);
              setTerminalOpen(false);
            }}
            onEmpty={() => {
              setStartBashOnTerminalOpen(false);
              setTerminalOpen(false);
            }}
          />
        </section>
      </div>

      <footer className="workspace-footer">
        <button
          className="keyboard-shortcut-hint"
          type="button"
          onClick={() => setShortcutGuideOpen(true)}
        >
          Keyboard shortcuts <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd>
        </button>
      </footer>

      <ShortcutGuideDialog
        isOpen={isShortcutGuideOpen}
        onClose={() => setShortcutGuideOpen(false)}
      />
    </div>
  );
}

export default EditorComponent;

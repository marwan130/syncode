import { useEffect, useRef, useState } from 'react';
import type { Monaco, OnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useNavigate, useParams } from 'react-router-dom';
import { MonacoCrdtBinding } from '../../bindings/MonacoCrdtBinding';
import { useAwareness } from '../../hooks/useAwareness';
import { useCrdtSync } from '../../hooks/useCrdtSync';
import { useChat } from '../../hooks/useChat';
import { useDebouncedPreview } from '../../hooks/useDebouncedPreview';
import { useExecutionStream } from '../../hooks/useExecutionStream';
import { useFileDiagnostics } from '../../hooks/useFileDiagnostics';
import { useAutocompletePreference } from '../../hooks/useAutocompletePreference';
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
  getStoredActiveFileId,
  getStoredExplorerWidth,
  getStoredPreviewWidth,
  getStoredTerminalHeight,
  storeActiveFileId,
} from './editorLayoutStorage';
import { EditorWorkspace } from './EditorWorkspace';
import { FileExplorerPanel } from './FileExplorerPanel';
import { ChatPanelContainer } from './ChatPanelContainer';
import { PreviewPanel } from './PreviewPanel';
import { TerminalPanel } from './TerminalPanel';
import { ShortcutGuideDialog } from './ShortcutGuideDialog';
import {
  validateCodeForExecution,
  type CodeValidationResult,
} from '../../utils/codeValidation';
import { configureMonacoEditor } from '../../utils/configureMonacoEditor';
import type {
  ExecutionLanguage,
  RoomEntry,
} from '../../providers/SignalRCrdtProvider';

const EXECUTION_LANGUAGES: Partial<Record<LanguageMode, ExecutionLanguage>> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  csharp: 'CSharp',
  c: 'C',
  cpp: 'Cpp',
  rust: 'Rust',
  java: 'Java',
};

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
  const [entries, setEntries] = useState<RoomEntry[]>([]);
  const [activeFileId, setActiveFileId] = useState('main.cpp');
  const activeFileIdRef = useRef(activeFileId);
  activeFileIdRef.current = activeFileId;
  const [openFileIds, setOpenFileIds] = useState<string[]>(['main.cpp']);
  const [splitFileId, setSplitFileId] = useState<string | null>(null);
  const [isSplitWorkspaceOpen, setSplitWorkspaceOpen] = useState(false);
  const [activeEditorGroup, setActiveEditorGroup] = useState<
    'primary' | 'secondary'
  >('primary');
  const [splitWidth, setSplitWidth] = useState(50);
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

  const activeFile = entries.find(
    (entry) => entry.id === activeFileId && !entry.isFolder
  );
  const splitFile = splitFileId
    ? entries.find((entry) => entry.id === splitFileId && !entry.isFolder)
    : undefined;
  const activeFilePath = activeFile ? getEntryPath(activeFile, entries) : '';
  const splitFilePath = splitFile ? getEntryPath(splitFile, entries) : '';
  const language: LanguageMode = languageForFileName(activeFilePath);

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

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    const offFiles = provider.onFilesChange((next) => {
      setEntries(next);
      setOpenFileIds((current) =>
        current.filter((id) =>
          next.some((entry) => entry.id === id && !entry.isFolder)
        )
      );
      setSplitFileId((current) =>
        current && next.some((entry) => entry.id === current && !entry.isFolder)
          ? current
          : null
      );
      const preferredFileId = getStoredActiveFileId(roomId);
      if (
        preferredFileId &&
        next.some((entry) => entry.id === preferredFileId && !entry.isFolder)
      ) {
        provider.setActiveFile(preferredFileId);
        setActiveFileId(preferredFileId);
        setOpenFileIds((current) =>
          current.includes(preferredFileId)
            ? current
            : [...current, preferredFileId]
        );
        return;
      }
      if (
        next.length &&
        !next.some(
          (entry) => entry.id === activeFileIdRef.current && !entry.isFolder
        )
      ) {
        const fallback =
          next.find((entry) => !entry.isFolder)?.id ?? 'main.cpp';
        setActiveFileId(fallback);
        setOpenFileIds((current) =>
          current.includes(fallback) ? current : [...current, fallback]
        );
      }
    });
    const offActive = provider.onActiveFileChange((file) => {
      setActiveFileId(file.id);
      setOpenFileIds((current) =>
        current.includes(file.id) ? current : [...current, file.id]
      );
      storeActiveFileId(roomId, file.id);
    });
    return () => {
      offFiles();
      offActive();
    };
  }, [providerRef, roomId, status]);

  const [isChatOpen, setChatOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH);
  const [previewWidth, setPreviewWidth] = useState(getStoredPreviewWidth);
  const [isPreviewOpen, setPreviewOpen] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(getStoredTerminalHeight);
  const [isShortcutGuideOpen, setShortcutGuideOpen] = useState(false);
  const [newTerminalRequest, setNewTerminalRequest] = useState(0);
  const [startBashOnTerminalOpen, setStartBashOnTerminalOpen] = useState(false);
  const pendingFileActions = useRef(new Map<string, Promise<unknown>>());

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
  const sourceExtension = activeFilePath.split('.').pop()?.toLowerCase();
  const requiresProjectJsxTransform =
    sourceExtension === 'jsx' || sourceExtension === 'tsx';
  const executionLanguage = requiresProjectJsxTransform
    ? null
    : (EXECUTION_LANGUAGES[language] ?? null);
  const [validationResult, setValidationResult] = useState<CodeValidationResult>(() =>
    validateCodeForExecution({
      code: '',
      language,
      filePath: activeFilePath,
      isConnected: Boolean(activeFile && status === 'connected'),
    })
  );

  useEffect(() => {
    const checkValidation = () => {
      const model = monacoEditor?.getModel();
      const code = model ? model.getValue() : '';

      const result = validateCodeForExecution({
        code,
        language,
        filePath: activeFilePath,
        isConnected: Boolean(activeFile && status === 'connected'),
        monacoApi,
        model,
      });

      setValidationResult(result);
    };

    checkValidation();

    if (!monacoEditor) return;

    const disposableContent =
      monacoEditor.onDidChangeModelContent(checkValidation);
    const disposableMarkers =
      monacoApi?.editor.onDidChangeMarkers(checkValidation);

    return () => {
      disposableContent.dispose();
      disposableMarkers?.dispose();
    };
  }, [monacoEditor, monacoApi, language, activeFilePath, activeFile, status]);

  const canRunCode = Boolean(
    validationResult.canRun && executionLanguage && monacoEditor
  );
  const runDisabledReason = !executionLanguage
    ? requiresProjectJsxTransform
      ? 'This file type requires a project build and cannot run as a single file'
      : 'This file type cannot be executed'
    : validationResult.reason;

  const handleRunCode = () => {
    if (!canRunCode || isExecutionRunning || !executionLanguage || !monacoEditor)
      return;
    setStartBashOnTerminalOpen(false);
    setTerminalOpen(true);
    void runCode(executionLanguage, monacoEditor.getValue());
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isShortcutGuideOpen) {
        setShortcutGuideOpen(false);
        return;
      }
      if (isShortcutGuideOpen) return;
      if (event.key === 'F6') {
        event.preventDefault();
        const regions = [
          '.file-explorer',
          '.room-code-editor',
          '.chat-panel',
          '.live-preview',
          '.execution-terminal',
        ]
          .map((selector) => document.querySelector<HTMLElement>(selector))
          .filter((element): element is HTMLElement =>
            Boolean(element && element.getClientRects().length)
          );
        if (!regions.length) return;
        const active = document.activeElement;
        const current = regions.findIndex(
          (region) => region === active || region.contains(active)
        );
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex =
          current < 0
            ? direction > 0
              ? 0
              : regions.length - 1
            : (current + direction + regions.length) % regions.length;
        const next = regions[nextIndex];
        if (next.matches('.room-code-editor')) monacoEditor?.focus();
        else
          (
            next.querySelector<HTMLElement>('button, input, [tabindex="0"]') ??
            next
          ).focus();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.repeat)
        return;
      const target = event.target as HTMLElement | null;
      switch (event.key.toLowerCase()) {
        case 'k':
          event.preventDefault();
          setShortcutGuideOpen((open) => !open);
          break;
        case 't':
          event.preventDefault();
          if (isTerminalOpen) setTerminalOpen(false);
          else {
            setStartBashOnTerminalOpen(true);
            setTerminalOpen(true);
          }
          break;
        case 'n':
          event.preventDefault();
          if (isTerminalOpen) setNewTerminalRequest((value) => value + 1);
          else {
            setStartBashOnTerminalOpen(true);
            setTerminalOpen(true);
          }
          break;
        case 'q':
          if (isTerminalOpen && target?.closest('.execution-terminal')) {
            event.preventDefault();
            window.dispatchEvent(new Event('syncode:terminal-close-active'));
          }
          break;
        case 'e':
          event.preventDefault();
          setExplorerOpen((open) => !open);
          break;
        case 'c':
          event.preventDefault();
          setChatOpen((open) => !open);
          break;
        case 'p':
          if (isPreviewLanguage(language)) {
            event.preventDefault();
            setPreviewOpen((open) => !open);
          }
          break;
        case 'r':
          if (canRunCode && executionLanguage && monacoEditor) {
            event.preventDefault();
            handleRunCode();
          }
          break;
        case 'w':
          if (isTerminalOpen) {
            event.preventDefault();
            setStartBashOnTerminalOpen(false);
            setTerminalOpen(false);
          }
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isShortcutGuideOpen,
    isTerminalOpen,
    language,
    canRunCode,
    executionLanguage,
    monacoEditor,
    runCode,
  ]);

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

  useEffect(() => {
    if (!monacoApi || !providerRef.current) return;
    const provider = providerRef.current;

    openFileIds.forEach((fileId) => {
      const entry = entries.find((e) => e.id === fileId && !e.isFolder);
      if (!entry) return;
      const filePath = getEntryPath(entry, entries);
      const uri = monacoApi.Uri.parse(filePath);
      const existing = monacoApi.editor.getModel(uri);
      if (!existing) {
        const content = provider.getFileContent(fileId);
        const lang = languageForFileName(filePath);
        monacoApi.editor.createModel(content, lang, uri);
      }
    });
  }, [monacoApi, openFileIds, entries, providerRef]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!monacoEditor || !provider) return;

    if (!activeFileId) return;
    monacoEditor.setValue(provider.getFileContent(activeFileId));
    const binding = new MonacoCrdtBinding(monacoEditor, provider, activeFileId);
    const unsubscribeCursor = binding.onCursorChange(broadcastCursor);

    return () => {
      unsubscribeCursor();
      binding.dispose();
    };
  }, [monacoEditor, providerRef, status, broadcastCursor, activeFileId]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!splitMonacoEditor || !provider || !splitFileId) return;
    splitMonacoEditor.setValue(provider.getFileContent(splitFileId));
    const binding = new MonacoCrdtBinding(
      splitMonacoEditor,
      provider,
      splitFileId
    );
    return () => binding.dispose();
  }, [splitMonacoEditor, providerRef, status, splitFileId]);

  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    configureMonacoEditor(monacoInstance);
    setMonacoEditor(editor);
    setMonacoApi(monacoInstance);
  };

  const openFile = (fileId: string, group = activeEditorGroup) => {
    setOpenFileIds((current) =>
      current.includes(fileId) ? current : [...current, fileId]
    );
    setActiveEditorGroup(group);
    if (group === 'secondary' && isSplitWorkspaceOpen) setSplitFileId(fileId);
    else {
      if (splitFileId === fileId) setSplitFileId(null);
      setActiveFileId(fileId);
      providerRef.current?.setActiveFile(fileId);
    }
  };

  const closeFileTab = (fileId: string) => {
    const index = openFileIds.indexOf(fileId);
    const next = openFileIds.filter((id) => id !== fileId);
    setOpenFileIds(next);
    if (splitFileId === fileId) setSplitFileId(null);
    if (activeFileId === fileId) {
      const nextActive = next[Math.min(index, next.length - 1)];
      if (nextActive) {
        setActiveFileId(nextActive);
        providerRef.current?.setActiveFile(nextActive);
      } else {
        setActiveFileId('');
      }
    }
  };

  const handleDropFile = (fileId: string, group: 'primary' | 'secondary') => {
    setOpenFileIds((current) =>
      current.includes(fileId) ? current : [...current, fileId]
    );
    if (group === 'primary') {
      setSplitWorkspaceOpen(true);
      setSplitFileId(fileId);
      setActiveEditorGroup('secondary');
    } else {
      setSplitFileId(fileId);
      setActiveEditorGroup('secondary');
    }
  };

  const runFileAction = <T,>(
    key: string,
    action: () => Promise<T>
  ): Promise<T | void> => {
    const pending = pendingFileActions.current.get(key);
    if (pending) return pending as Promise<T | void>;
    const operation = action()
      .catch((error: unknown) => {
        window.alert(
          error instanceof Error ? error.message : 'File operation failed.'
        );
      })
      .finally(() => {
        if (pendingFileActions.current.get(key) === operation)
          pendingFileActions.current.delete(key);
      });
    pendingFileActions.current.set(key, operation);
    return operation;
  };

  const createEntry = (isFolder: boolean, parentId: string | null) => {
    const name = window.prompt(
      isFolder ? 'New folder name' : 'New file name',
      isFolder ? 'New Folder' : 'untitled.ts'
    );
    if (!name?.trim() || !providerRef.current) return Promise.resolve();
    return runFileAction(
      `create:${isFolder ? 'folder' : 'file'}:${parentId ?? 'root'}`,
      () => providerRef.current!.createEntry(name, parentId, isFolder)
    );
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
          setTerminalOpen(true);
        }}
        onRunCode={handleRunCode}
      />

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
          onCreateFile={(parentId) => createEntry(false, parentId)}
          onCreateFolder={(parentId) => createEntry(true, parentId)}
          onRename={(entry) => {
            const name = window.prompt(
              `Rename ${entry.isFolder ? 'folder' : 'file'}`,
              entry.name
            );
            if (name?.trim())
              runFileAction(`rename:${entry.id}`, () =>
                providerRef.current!.renameEntry(entry.id, name)
              );
          }}
          onDelete={(entry) => {
            const prompt = entry.isFolder
              ? `Delete folder "${entry.name}" and everything inside it?`
              : `Delete ${entry.name}?`;
            if (window.confirm(prompt))
              runFileAction(`delete:${entry.id}`, () =>
                providerRef.current!.deleteEntry(entry.id)
              );
          }}
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

import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { useEffect, useState } from 'react';
import type * as monaco from 'monaco-editor';
import { useNavigate, useParams } from 'react-router-dom';
import { MonacoCrdtBinding } from '../../bindings/MonacoCrdtBinding';
import { useAwareness } from '../../hooks/useAwareness';
import { useCrdtSync } from '../../hooks/useCrdtSync';
import {
  createSiteId,
  getStoredColor,
  getStoredDisplayName,
} from '../../utils/userStorage';
import { Cursors } from './Cursors';
import { LivePreview } from './LivePreview';
import { useDebouncedPreview } from '../../hooks/useDebouncedPreview';
import {
  isPreviewLanguage,
  languageForFileName,
  type LanguageMode,
} from './languageModes';
import { RoomHeader } from '../room/RoomHeader';
import { useChat } from '../../hooks/useChat';
import { ChatPanel } from '../chat/ChatPanel';
import { FileExplorer } from './FileExplorer';
import { ResizeHandle } from './ResizeHandle';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';

interface EditorProps {
  roomId?: string;
  accessKey: string;
}

const PREVIEW_WIDTH_KEY = 'syncode_live_preview_width';
const PREVIEW_CLOSE_THRESHOLD = 24;

function getStoredActiveFileId(roomId: string): string | null {
  try {
    return sessionStorage.getItem(`syncode_active_file:${roomId}`);
  } catch {
    return null;
  }
}

function storeActiveFileId(roomId: string, fileId: string): void {
  try {
    sessionStorage.setItem(`syncode_active_file:${roomId}`, fileId);
  } catch {
    // Keep the selected file for the current session when storage is available.
  }
}

function getStoredPreviewWidth(): number {
  try {
    const width = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
    return Number.isFinite(width) && width > 0
      ? Math.max(120, Math.min(1000, width))
      : 420;
  } catch {
    return 420;
  }
}

function storePreviewWidth(width: number): void {
  try {
    localStorage.setItem(PREVIEW_WIDTH_KEY, String(width));
  } catch {
    // The preview still works for this session if storage is unavailable.
  }
}

function getEntryPath(entry: RoomEntry, entries: RoomEntry[]): string {
  const path = [entry.name];
  let parentId = entry.parentId;
  while (parentId) {
    const parent = entries.find(
      (item) => item.id === parentId && item.isFolder
    );
    if (!parent) break;
    path.unshift(parent.name);
    parentId = parent.parentId;
  }
  return path.join('/');
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
  const [localColor, setLocalColor] = useState(getStoredColor);
  const [entries, setEntries] = useState<RoomEntry[]>([]);
  const [activeFileId, setActiveFileId] = useState('main.cpp');
  const [isExplorerOpen, setExplorerOpen] = useState(true);
  const [siteId] = useState(createSiteId);
  const [monacoApi, setMonacoApi] = useState<Monaco | null>(null);
  const [monacoEditor, setMonacoEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const activeFile =
    entries.find((entry) => entry.id === activeFileId && !entry.isFolder) ??
    entries.find((entry) => !entry.isFolder);
  const activeFilePath = activeFile
    ? getEntryPath(activeFile, entries)
    : 'main.cpp';
  const language: LanguageMode = languageForFileName(activeFilePath);

  const { status, providerRef, evictedNewRoomId } = useCrdtSync({
    siteId,
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
      const preferredFileId = getStoredActiveFileId(roomId);
      if (
        preferredFileId &&
        next.some((entry) => entry.id === preferredFileId && !entry.isFolder)
      ) {
        provider.setActiveFile(preferredFileId);
        setActiveFileId(preferredFileId);
        return;
      }
      if (
        next.length &&
        !next.some((entry) => entry.id === activeFileId && !entry.isFolder)
      )
        setActiveFileId(
          next.find((entry) => !entry.isFolder)?.id ?? 'main.cpp'
        );
    });
    const offActive = provider.onActiveFileChange((file) => {
      setActiveFileId(file.id);
      storeActiveFileId(roomId, file.id);
    });
    return () => {
      offFiles();
      offActive();
    };
  }, [providerRef, roomId, status, activeFileId]);
  const [isChatOpen, setChatOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(300);
  const [previewWidth, setPreviewWidth] = useState(getStoredPreviewWidth);
  const [isPreviewOpen, setPreviewOpen] = useState(true);
  const { messages, sendMessage } = useChat({ providerRef, status });

  useEffect(() => {
    if (evictedNewRoomId)
      navigate(`/room/${evictedNewRoomId}`, { replace: true });
  }, [evictedNewRoomId, navigate]);

  const { peers, broadcastCursor } = useAwareness({
    providerRef,
    status,
    localName: displayName || 'Anonymous',
    localColor,
  });
  const previewSource = useDebouncedPreview({
    providerRef,
    status,
    enabled: isPreviewLanguage(language),
    activeFileId,
  });

  useEffect(() => {
    const provider = providerRef.current;
    if (!monacoEditor || !provider) return;

    monacoEditor.setValue(provider.doc.toVisibleString());
    const binding = new MonacoCrdtBinding(monacoEditor, provider);
    const unsubscribeCursor = binding.onCursorChange(broadcastCursor);

    return () => {
      unsubscribeCursor();
      binding.dispose();
    };
  }, [monacoEditor, providerRef, status, broadcastCursor, activeFileId]);

  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    setMonacoEditor(editor);
    setMonacoApi(monacoInstance);
  };

  const runFileAction = <T,>(action: () => Promise<T>): Promise<T | void> =>
    action().catch((error: unknown) => {
      window.alert(
        error instanceof Error ? error.message : 'File operation failed.'
      );
    });

  const createEntry = (isFolder: boolean, parentId: string | null) => {
    const name = window.prompt(
      isFolder ? 'New folder name' : 'New file name',
      isFolder ? 'New Folder' : 'untitled.ts'
    );
    if (!name?.trim() || !providerRef.current) return Promise.resolve();
    return runFileAction(() =>
      providerRef.current!.createEntry(name, parentId, isFolder)
    );
  };

  return (
    <div className="room-workspace">
      <RoomHeader
        roomId={roomId}
        status={status}
        localName={displayName}
        localColor={localColor}
        onJoinProfile={({ displayName: name, color }) => {
          setProfile({ roomId, displayName: name });
          setLocalColor(color);
        }}
        onColorChange={setLocalColor}
        peers={peers}
        editor={monacoEditor}
        monaco={monacoApi}
        explorerOpen={isExplorerOpen}
        onToggleExplorer={() => setExplorerOpen((open) => !open)}
        isChatOpen={isChatOpen}
        onToggleChat={() => setChatOpen((open) => !open)}
        showPreviewButton={isPreviewLanguage(language)}
        onShowPreview={() => setPreviewOpen((open) => !open)}
      />

      <div className="room-main">
        {isExplorerOpen && (
          <FileExplorer
            entries={entries}
            activeFileId={activeFileId}
            onSelect={(id) => providerRef.current?.setActiveFile(id)}
            onCreateFile={(parentId) => createEntry(false, parentId)}
            onCreateFolder={(parentId) => createEntry(true, parentId)}
            onRename={(entry) => {
              const name = window.prompt(
                `Rename ${entry.isFolder ? 'folder' : 'file'}`,
                entry.name
              );
              if (name?.trim())
                runFileAction(() =>
                  providerRef.current!.renameEntry(entry.id, name)
                );
            }}
            onDelete={(entry) => {
              const prompt = entry.isFolder
                ? `Delete folder "${entry.name}" and everything inside it?`
                : `Delete ${entry.name}?`;
              if (window.confirm(prompt))
                runFileAction(() => providerRef.current!.deleteEntry(entry.id));
            }}
          />
        )}
        {isChatOpen && (
          <>
            <ChatPanel
              messages={messages}
              onSendMessage={sendMessage}
              disabled={status !== 'connected'}
              style={{ flexBasis: chatWidth }}
            />
            <ResizeHandle
              label="Resize chat panel"
              onResize={(delta) =>
                setChatWidth((width) => Math.max(200, Math.min(600, width + delta)))
              }
            />
          </>
        )}
        <div
          className={`room-editor${isPreviewLanguage(language) ? ' has-live-preview' : ''}`}
        >
          <div className="room-code-editor">
            <Editor
              height="100%"
              language={language}
              path={activeFilePath}
              defaultValue=""
              theme="vs-dark"
              onMount={handleEditorMount}
              options={{
                automaticLayout: true,
                fontSize: 14,
                minimap: { enabled: true },
                readOnly: status !== 'connected',
              }}
            />
            {monacoEditor && (
              <Cursors
                editor={monacoEditor}
                peers={peers}
                providerRef={providerRef}
                status={status}
                fileId={activeFileId}
              />
            )}
          </div>
          {isPreviewLanguage(language) && isPreviewOpen && (
            <>
              <ResizeHandle
                label="Resize live preview"
                reverse
                onResize={(delta) => {
                  const nextWidth = Math.min(1000, previewWidth + delta);
                  if (nextWidth <= PREVIEW_CLOSE_THRESHOLD) {
                    setPreviewOpen(false);
                    return;
                  }
                  setPreviewWidth(nextWidth);
                  storePreviewWidth(nextWidth);
                }}
              />
              <LivePreview
                project={previewSource}
                language={language}
                monaco={monacoApi}
                editor={monacoEditor}
                style={{ flex: `0 0 ${previewWidth}px` }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default EditorComponent;

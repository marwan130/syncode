import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { useEffect, useState } from 'react';
import type * as monaco from 'monaco-editor';
import { useNavigate, useParams } from 'react-router-dom';
import { MonacoCrdtBinding } from '../../bindings/MonacoCrdtBinding';
import { useAwareness } from '../../hooks/useAwareness';
import { useCrdtSync } from '../../hooks/useCrdtSync';
import {
  getOrCreateSiteId,
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
import { RoomJoin } from '../room/RoomJoin';
import { useChat } from '../../hooks/useChat';
import { ChatPanel } from '../chat/ChatPanel';
import { FileExplorer } from './FileExplorer';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';

interface EditorProps {
  roomId?: string;
  accessKey: string;
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

  const [displayName, setDisplayName] = useState(getStoredDisplayName);
  const [localColor, setLocalColor] = useState(getStoredColor);
  const [isProfileOpen, setProfileOpen] = useState(false);
  const [entries, setEntries] = useState<RoomEntry[]>([]);
  const [activeFileId, setActiveFileId] = useState('main.cpp');
  const [isExplorerOpen, setExplorerOpen] = useState(true);
  const [siteId] = useState(getOrCreateSiteId);
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
      if (
        next.length &&
        !next.some((entry) => entry.id === activeFileId && !entry.isFolder)
      )
        setActiveFileId(
          next.find((entry) => !entry.isFolder)?.id ?? 'main.cpp'
        );
    });
    const offActive = provider.onActiveFileChange((file) =>
      setActiveFileId(file.id)
    );
    return () => {
      offFiles();
      offActive();
    };
  }, [providerRef, status, activeFileId]);
  const [isChatOpen, setChatOpen] = useState(false);
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
      {(!displayName || isProfileOpen) && (
        <RoomJoin
          defaultName={displayName || ''}
          onCancel={displayName ? () => setProfileOpen(false) : undefined}
          onJoin={({ displayName: name, color }) => {
            setDisplayName(name);
            setLocalColor(color);
            setProfileOpen(false);
          }}
        />
      )}

      <RoomHeader
        roomId={roomId}
        status={status}
        localName={displayName || 'Joining...'}
        localColor={localColor}
        peers={peers}
        onEditProfile={() => setProfileOpen(true)}
        editor={monacoEditor}
        monaco={monacoApi}
        explorerOpen={isExplorerOpen}
        onToggleExplorer={() => setExplorerOpen((open) => !open)}
        isChatOpen={isChatOpen}
        onToggleChat={() => setChatOpen((open) => !open)}
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
              />
            )}
          </div>
          {isPreviewLanguage(language) && (
            <LivePreview
              source={previewSource}
              language={language}
              monaco={monacoApi}
              editor={monacoEditor}
            />
          )}
        </div>
        {isChatOpen && (
          <ChatPanel
            messages={messages}
            onSendMessage={sendMessage}
            disabled={status !== 'connected'}
          />
        )}
      </div>
    </div>
  );
}

export default EditorComponent;

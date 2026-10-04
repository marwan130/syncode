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
import { isPreviewLanguage, type LanguageMode } from './languageModes';
import { RoomHeader } from '../room/RoomHeader';
import { RoomJoin } from '../room/RoomJoin';
import { useChat } from '../../hooks/useChat';
import { ChatPanel } from '../chat/ChatPanel';

interface EditorProps {
  roomId?: string;
  accessKey: string;
}

function EditorComponent({ roomId: propRoomId, accessKey }: EditorProps) {
  const params = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const roomId = propRoomId ?? params.roomId ?? '';

  const [displayName, setDisplayName] = useState(getStoredDisplayName);
  const [localColor, setLocalColor] = useState(getStoredColor);
  const [isProfileOpen, setProfileOpen] = useState(false);
  const [language, setLanguage] = useState<LanguageMode>('cpp');
  const [siteId] = useState(getOrCreateSiteId);
  const [monacoApi, setMonacoApi] = useState<Monaco | null>(null);
  const [monacoEditor, setMonacoEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);

  const { status, providerRef, evictedNewRoomId } = useCrdtSync({
    siteId,
    roomId,
    accessKey,
    displayName: displayName || undefined,
    color: localColor,
    enabled: Boolean(roomId && accessKey && displayName),
  });
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
  }, [monacoEditor, providerRef, status, broadcastCursor]);

  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    setMonacoEditor(editor);
    setMonacoApi(monacoInstance);
  };

  const handleLanguageChange = (nextLanguage: LanguageMode) => {
    setLanguage(nextLanguage);
    const model = monacoEditor?.getModel();
    if (model) monacoApi?.editor.setModelLanguage(model, nextLanguage);
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
        language={language}
        onLanguageChange={handleLanguageChange}
        isChatOpen={isChatOpen}
        onToggleChat={() => setChatOpen((open) => !open)}
      />

      <div className="room-main">
        <div
          className={`room-editor${isPreviewLanguage(language) ? ' has-live-preview' : ''}`}
        >
          <div className="room-code-editor">
            <Editor
              height="100%"
              defaultLanguage="cpp"
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

import Editor, { type OnMount } from '@monaco-editor/react';
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
import { RoomHeader } from '../room/RoomHeader';
import { RoomJoin } from '../room/RoomJoin';

interface EditorProps {
  roomId?: string;
}

function EditorComponent({ roomId: propRoomId }: EditorProps) {
  const params = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const roomId = propRoomId ?? params.roomId ?? '';

  const [displayName, setDisplayName] = useState(getStoredDisplayName);
  const [localColor, setLocalColor] = useState(getStoredColor);
  const [isProfileOpen, setProfileOpen] = useState(false);
  const [siteId] = useState(getOrCreateSiteId);
  const [monacoEditor, setMonacoEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);

  const { status, providerRef, evictedNewRoomId } = useCrdtSync({
    siteId,
    roomId,
    displayName: displayName || undefined,
    color: localColor,
    enabled: Boolean(roomId && displayName),
  });

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

  const handleEditorMount: OnMount = (editor) => setMonacoEditor(editor);

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
      />

      <div className="room-editor">
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
    </div>
  );
}

export default EditorComponent;

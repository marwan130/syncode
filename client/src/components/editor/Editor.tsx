import Editor, { type OnMount } from '@monaco-editor/react';
import { useRef, useEffect, useState } from 'react';
import type * as monaco from 'monaco-editor';
import { v4 as uuidv4 } from 'uuid';
import { useCrdtSync } from '../../hooks/useCrdtSync';
import { useAwareness } from '../../hooks/useAwareness';
import { MonacoCrdtBinding } from '../../bindings/MonacoCrdtBinding';
import type { CrdtDocument } from '../../crdt/CrdtDocument';
import { Cursors } from './Cursors';
import { RoomHeader } from '../room/RoomHeader';

/**
 * props are wrapped in an interface so parent components can pass a single configuration object
 * instead of relying on positional arguments, making optional settings like serverUrl cleaner to extend
 */
interface EditorProps {
  roomId?: string;
}

// deterministically assigned per tab from a visually distinct palette
const CURSOR_COLORS = [
  '#f97316', // orange
  '#22d3ee', // cyan
  '#a78bfa', // violet
  '#4ade80', // green
  '#f472b6', // pink
  '#facc15', // yellow
  '#60a5fa', // blue
  '#fb7185', // rose
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

const SITE_ID = uuidv4();
const LOCAL_COLOR = CURSOR_COLORS[hashCode(SITE_ID) % CURSOR_COLORS.length];
const DISPLAY_NAME = `User ${SITE_ID.slice(0, 6)}`;

function EditorComponent({ roomId = 'default-room' }: EditorProps) {
  const bindingRef = useRef<MonacoCrdtBinding | null>(null);

  // stored in state so renders fire when the editor / doc become available
  const [monacoEditor, setMonacoEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [crdtDoc, setCrdtDoc] = useState<CrdtDocument | null>(null);

  const { status, providerRef } = useCrdtSync({
    siteId: SITE_ID,
    roomId,
  });

  const { peers, broadcastCursor } = useAwareness({
    providerRef,
    status,
    localName: DISPLAY_NAME,
    localColor: LOCAL_COLOR,
  });

  useEffect(() => {
    const editor = monacoEditor;
    const provider = providerRef.current;
    if (!editor || !provider) return;

    editor.setValue(provider.doc.toVisibleString());
    bindingRef.current?.dispose();
    const binding = new MonacoCrdtBinding(editor, provider);
    bindingRef.current = binding;

    // wire cursor changes to awareness broadcast
    const unsubCursor = binding.onCursorChange(broadcastCursor);

    setCrdtDoc(provider.doc);

    return () => {
      unsubCursor();
      binding.dispose();
      bindingRef.current = null;
    };
  }, [monacoEditor, status, providerRef, broadcastCursor]);

  const handleEditorMount: OnMount = (editor) => {
    setMonacoEditor(editor);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
      }}
    >
      <RoomHeader
        roomId={roomId}
        status={status}
        localName={DISPLAY_NAME}
        localColor={LOCAL_COLOR}
        peers={peers}
      />

      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
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
          }}
        />

        {monacoEditor && crdtDoc && (
          <Cursors editor={monacoEditor} peers={peers} doc={crdtDoc} />
        )}
      </div>
    </div>
  );
}

export default EditorComponent;

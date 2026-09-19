import Editor, { type OnMount } from '@monaco-editor/react';
import { useRef, useEffect } from 'react';
import type * as monaco from 'monaco-editor';
import { useCrdtSync } from '../../hooks/useCrdtSync';
import { MonacoCrdtBinding } from '../../bindings/MonacoCrdtBinding';
import { v4 as uuidv4 } from 'uuid';

/**
 * props are wrapped in an interface so parent components can pass a single configuration object
 * instead of relying on positional arguments, making optional settings like serverUrl cleaner to extend
 */
interface EditorProps {
  roomId?: string;
}

const SITE_ID = uuidv4();

function EditorComponent({ roomId = 'default-room' }: EditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const bindingRef = useRef<MonacoCrdtBinding | null>(null);

  const { status, providerRef } = useCrdtSync({
    siteId: SITE_ID,
    roomId,
  });

  useEffect(() => {
    const editor = editorRef.current;
    const provider = providerRef.current;
    if (!editor || !provider) return;

    bindingRef.current?.dispose();
    bindingRef.current = new MonacoCrdtBinding(editor, provider);

    return () => {
      bindingRef.current?.dispose();
      bindingRef.current = null;
    };
  }, [status, providerRef]);

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
    const provider = providerRef.current;
    if (provider) {
      bindingRef.current?.dispose();
      bindingRef.current = new MonacoCrdtBinding(editor, provider);
    }
  };

  const isConnected = status === 'connected';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {!isConnected && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 500,
            backgroundColor: 'rgba(30, 30, 30, 0.92)',
            color: status === 'reconnecting' ? '#f0c040' : '#f0883e',
            border: `1px solid ${status === 'reconnecting' ? 'rgba(240, 192, 64, 0.45)' : 'rgba(240, 136, 62, 0.45)'}`,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(8px)',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <span>
            {status === 'reconnecting'
              ? 'Reconnecting…'
              : status === 'connecting'
                ? 'Connecting…'
                : 'You are offline. Edits are queued locally and will sync once reconnected.'}
          </span>
        </div>
      )}

      <Editor
        height="100vh"
        defaultLanguage="cpp"
        defaultValue="#include <iostream>"
        theme="vs-dark"
        onMount={handleEditorMount}
        options={{
          automaticLayout: true,
          fontSize: 14,
          minimap: { enabled: true },
        }}
      />
    </div>
  );
}

export default EditorComponent;

import Editor, { type OnMount } from '@monaco-editor/react';
import { useRef, useCallback } from 'react';
import type * as monaco from 'monaco-editor';
import { useSignalRConnection } from '../../hooks/useSignalRConnection';

/**
 * props are wrapped in an interface so parent components can pass a single configuration object
 * instead of relying on positional arguments, making optional settings like serverUrl cleaner to extend
 */
interface EditorProps {
  roomId?: string;
}

function EditorComponent({ roomId = 'default-room' }: EditorProps) {
  /**
   * reference to monaco editor instance so we can use monaco api methods without causing react re-renders
   */
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const isRemoteEditRef = useRef(false); // tracks whether an edit was made by a remote user or the local user

  const handleReceiveEdit = useCallback((incomingText: string) => {
    const editor = editorRef.current;
    if (!editor) return;

    const currentText = editor.getValue();
    if (currentText === incomingText) return;

    /**
     * flag raised to stop the editor from sending that incoming change back to the server
     * as if they typed it themselves, preventing echo loops
     */
    isRemoteEditRef.current = true;

    const selections = editor.getSelections();

    /**
     * retrieves a range spanning from line 1, column 1 to the end of the document
     * so executeEdits knows the exact boundaries required to replace the entire text
     * buffer without resetting cursor position or clearing undo stack history
     */
    const fullRange = editor.getModel()?.getFullModelRange();
    if (fullRange) {
      /**
       * applies the remote text update to run an in-place edit operation.
       * this allows monaco to replace document content while keeping
       * the local undo/redo history stack intact and preserving cursor position
       */
      editor.executeEdits('remote-sync', [
        {
          range: fullRange,
          text: incomingText,
          forceMoveMarkers: true,
        },
      ]);

      if (selections) {
        editor.setSelections(selections);
      }
    }

    isRemoteEditRef.current = false;
  }, []);

  const { isConnected, sendEdit } = useSignalRConnection({
    roomId,
    onReceiveEdit: handleReceiveEdit,
  });

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  const handleEditorChange = (value: string | undefined) => {
    if (isRemoteEditRef.current) return;

    const nextText = value ?? '';
    sendEdit(nextText);
  };

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
            color: '#f0883e',
            border: '1px solid rgba(240, 136, 62, 0.45)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(8px)',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <span>
            You are offline. Edits are queued locally and will sync once
            reconnected.
          </span>
        </div>
      )}

      <Editor
        height="100vh"
        defaultLanguage="cpp"
        defaultValue="#include <iostream>"
        theme="vs-dark"
        onChange={handleEditorChange}
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

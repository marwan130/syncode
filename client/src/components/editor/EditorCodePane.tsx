import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type * as monaco from 'monaco-editor';
import '../../utils/initializeMonaco';
import type {
  AwarenessState,
  ConnectionStatus,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';
import { configureMonacoEditor } from '../../utils/configureMonacoEditor';
import { connectModelToLanguageServer } from '../../utils/monacoLanguageServers';
import { getEditorModelPath } from './editorLayoutStorage';
import { Cursors } from './Cursors';
import type { LanguageMode } from './languageModes';

export interface EditorCodePaneProps {
  fileId: string;
  filePath: string;
  language: LanguageMode;
  status: ConnectionStatus;
  isLocked: boolean;
  autocompleteEnabled: boolean;
  minimapEnabled: boolean;
  onMount: OnMount;
  onDispose?: () => void;
  peers?: Map<string, AwarenessState>;
  providerRef?: RefObject<SignalRCrdtProvider | null>;
  roomId?: string;
}

export function EditorCodePane({
  fileId,
  filePath,
  language,
  status,
  isLocked,
  autocompleteEnabled,
  minimapEnabled,
  onMount,
  onDispose,
  peers,
  providerRef,
  roomId: propRoomId,
}: EditorCodePaneProps) {
  const [modelRoomId, setModelRoomId] = useState(propRoomId ?? '');

  useEffect(() => {
    const activeRoomId = propRoomId ?? providerRef?.current?.getRoomId() ?? '';
    if (activeRoomId && activeRoomId !== modelRoomId) {
      setModelRoomId(activeRoomId);
    }
  }, [propRoomId, providerRef, modelRoomId]);

  const [mountedEditor, setMountedEditor] = useState<{
    editor: monaco.editor.IStandaloneCodeEditor;
    monaco: Monaco;
  } | null>(null);
  const handleMount: OnMount = useCallback(
    (editor, monacoInstance) => {
      onMount(editor, monacoInstance);
      setMountedEditor({ editor, monaco: monacoInstance });
    },
    [onMount]
  );

  useEffect(() => {
    const currentProvider = providerRef?.current;
    const currentEditor = mountedEditor;
    const model = currentEditor?.editor.getModel();
    if (
      status !== 'connected' ||
      !currentProvider ||
      !currentEditor ||
      !model ||
      !filePath
    )
      return;

    let disposed = false;
    let release: (() => void) | undefined;
    void connectModelToLanguageServer(
      currentEditor.monaco,
      currentProvider,
      language,
      model,
      fileId,
      filePath
    )
      .then((close) => {
        if (disposed) close();
        else release = close;
      })
      .catch((error: unknown) => {
        console.error(
          `Language server failed for ${language} (${filePath}).`,
          error
        );
      });

    return () => {
      disposed = true;
      release?.();
    };
  }, [fileId, filePath, language, mountedEditor, providerRef, status]);

  useEffect(() => () => onDispose?.(), [onDispose]);

  return (
    <div
      className={`room-code-editor${minimapEnabled ? '' : ' split-code-editor'}`}
    >
      <Editor
        height="100%"
        language={language}
        path={getEditorModelPath(modelRoomId, fileId)}
        defaultValue=""
        theme="syncode-current-theme"
        beforeMount={configureMonacoEditor}
        onMount={handleMount}
        options={{
          automaticLayout: true,
          fontSize: 14,
          minimap: { enabled: minimapEnabled },
          readOnly:
            isLocked ||
            status === 'awaiting-approval' ||
            status === 'join-rejected',
          renderValidationDecorations: 'on',
          glyphMargin: true,
          lightbulb: {
            enabled: 'on' as monaco.editor.ShowLightbulbIconMode,
          },
          fixedOverflowWidgets: true,
          quickSuggestions: autocompleteEnabled,
          suggestOnTriggerCharacters: autocompleteEnabled,
          wordBasedSuggestions: autocompleteEnabled
            ? ('currentDocument' as const)
            : ('off' as const),
          parameterHints: { enabled: autocompleteEnabled },
        }}
      />
      {mountedEditor && peers && providerRef && status === 'connected' && (
        <Cursors
          editor={mountedEditor.editor}
          peers={peers}
          providerRef={providerRef}
          status={status}
          fileId={fileId}
        />
      )}
    </div>
  );
}

import Editor, { type OnMount } from '@monaco-editor/react';
import type { RefObject } from 'react';
import type * as monaco from 'monaco-editor';
import type {
  AwarenessState,
  ConnectionStatus,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';
import { configureMonacoEditor } from '../../utils/configureMonacoEditor';
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
  editor?: monaco.editor.IStandaloneCodeEditor | null;
  peers?: Map<string, AwarenessState>;
  providerRef?: RefObject<SignalRCrdtProvider | null>;
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
  editor,
  peers,
  providerRef,
}: EditorCodePaneProps) {
  return (
    <div
      className={`room-code-editor${minimapEnabled ? '' : ' split-code-editor'}`}
    >
      <Editor
        height="100%"
        language={language}
        path={filePath}
        defaultValue=""
        theme="syncode-current-theme"
        beforeMount={configureMonacoEditor}
        onMount={onMount}
        options={{
          automaticLayout: true,
          fontSize: 14,
          minimap: { enabled: minimapEnabled },
          readOnly: status !== 'connected' || isLocked,
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
      {editor && peers && providerRef && (
        <Cursors
          editor={editor}
          peers={peers}
          providerRef={providerRef}
          status={status}
          fileId={fileId}
        />
      )}
    </div>
  );
}

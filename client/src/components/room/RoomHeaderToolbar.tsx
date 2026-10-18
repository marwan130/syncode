import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import type { ConnectionStatus } from '../../providers/SignalRCrdtProvider';
import { SearchReplace } from '../editor/SearchReplace';
import { ThemePicker } from '../editor/ThemePicker';

interface RoomHeaderToolbarProps {
  status: ConnectionStatus;
  editor: monaco.editor.IStandaloneCodeEditor | null;
  monaco: Monaco | null;
  autocompleteEnabled: boolean;
  onAutocompleteChange: (enabled: boolean) => void;
  showPreviewButton: boolean;
  onShowPreview: () => void;
  canRunCode: boolean;
  runDisabledReason?: string;
  isRunningCode: boolean;
  onRunCode: () => void;
  onOpenTerminal: () => void;
}

export function RoomHeaderToolbar({
  status,
  editor,
  monaco,
  autocompleteEnabled,
  onAutocompleteChange,
  showPreviewButton,
  onShowPreview,
  canRunCode,
  runDisabledReason,
  isRunningCode,
  onRunCode,
  onOpenTerminal,
}: RoomHeaderToolbarProps) {
  return (
    <>
      <button
        className={`chat-toggle${autocompleteEnabled ? ' is-active' : ''}`}
        type="button"
        role="switch"
        aria-checked={autocompleteEnabled}
        aria-label="Automatic code suggestions"
        title={`Automatic code suggestions: ${autocompleteEnabled ? 'On' : 'Off'}`}
        onClick={() => onAutocompleteChange(!autocompleteEnabled)}
      >
        Suggestions {autocompleteEnabled ? 'On' : 'Off'}
      </button>

      <ThemePicker monaco={monaco} />
      <SearchReplace editor={editor} />

      <button
        className="execution-run-button"
        type="button"
        onClick={onRunCode}
        disabled={!canRunCode || isRunningCode}
        aria-keyshortcuts="Control+Alt+R"
        title={
          isRunningCode
            ? 'Execution in progress…'
            : canRunCode
              ? 'Compile and run the active file (Ctrl+Alt+R)'
              : runDisabledReason || 'Cannot run code'
        }
      >
        {isRunningCode ? (
          'Running…'
        ) : (
          <>
            <svg className="run-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 2.8v10.4L13 8z" fill="currentColor" />
            </svg>
            <span className="visually-hidden">Run</span>
          </>
        )}
      </button>

      <button
        className="execution-run-button"
        type="button"
        onClick={onOpenTerminal}
        disabled={status !== 'connected'}
        title="Open a Bash terminal (Ctrl+Alt+T)"
        aria-keyshortcuts="Control+Alt+T"
      >
        Terminal
      </button>

      {showPreviewButton && (
        <button
          className="preview-view-button"
          type="button"
          onClick={onShowPreview}
          aria-keyshortcuts="Control+Alt+P"
        >
          View
        </button>
      )}
    </>
  );
}

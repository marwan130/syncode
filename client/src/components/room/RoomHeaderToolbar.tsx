import { ThemePicker } from '../editor/ThemePicker';

export interface RoomHeaderToolbarProps {
  monaco: import('@monaco-editor/react').Monaco | null;
  autocompleteEnabled: boolean;
  onAutocompleteChange: (enabled: boolean) => void;
  showPreviewButton: boolean;
  onShowPreview: () => void;
}

export function RoomHeaderToolbar({
  monaco,
  autocompleteEnabled,
  onAutocompleteChange,
  showPreviewButton,
  onShowPreview,
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

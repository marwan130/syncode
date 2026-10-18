import { useState } from 'react';
import type { FC } from 'react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { getEntryPath } from './editorLayoutStorage';

interface EmptyEditorPaneProps {
  entries: RoomEntry[];
  group: 'primary' | 'secondary';
  onOpenFile: (fileId: string, group?: 'primary' | 'secondary') => void;
}

export const EmptyEditorPane: FC<EmptyEditorPaneProps> = ({
  entries,
  group,
  onOpenFile,
}) => {
  const [isFilePickerOpen, setFilePickerOpen] = useState(false);
  const files = entries.filter((entry) => !entry.isFolder);

  return (
    <div className="editor-empty-pane">
      <button
        type="button"
        className="editor-drop-placeholder"
        onClick={() => setFilePickerOpen(true)}
      >
        Select a file to start editing.
      </button>
      {isFilePickerOpen && (
        <div
          className="editor-file-picker-backdrop"
          onClick={() => setFilePickerOpen(false)}
        >
          <div
            className="editor-file-picker"
            role="dialog"
            aria-modal="true"
            aria-label="Select a file to open"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setFilePickerOpen(false);
            }}
          >
            <div className="editor-file-picker-heading">
              <span>Select a file</span>
              <button type="button" onClick={() => setFilePickerOpen(false)}>
                Close
              </button>
            </div>
            <div className="editor-file-picker-list">
              {files.length ? (
                files.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      onOpenFile(entry.id, group);
                      setFilePickerOpen(false);
                    }}
                  >
                    {getEntryPath(entry, entries)}
                  </button>
                ))
              ) : (
                <span className="editor-file-picker-empty">
                  No files are available.
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

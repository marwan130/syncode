import { useState } from 'react';
import type { FC } from 'react';
import { Icon } from '@iconify/react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { getEntryPath } from './editorLayoutStorage';
import { getFileIcon } from './fileExplorerUtils';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';

export interface EmptyEditorPaneProps {
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
      {files.length ? (
        <button
          type="button"
          className="editor-drop-placeholder"
          onClick={() => setFilePickerOpen(true)}
        >
          Select a file to start editing.
        </button>
      ) : (
        <div className="editor-drop-placeholder is-empty">
          This workspace is empty. Create a file in the Explorer to start
          editing.
        </div>
      )}
      {isFilePickerOpen && (
        <div
          className="editor-file-picker-backdrop"
          onClick={() => setFilePickerOpen(false)}
        >
          <div
            className="editor-file-picker"
            style={{ height: Math.min(420, files.length * 30 + 52) }}
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
            <ScrollbarPanel className="editor-file-picker-list">
              {files.length ? (
                files.map((entry) => {
                  const path = getEntryPath(entry, entries);
                  const parentPath = path.slice(0, path.lastIndexOf('/'));
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      title={path}
                      onClick={() => {
                        onOpenFile(entry.id, group);
                        setFilePickerOpen(false);
                      }}
                    >
                      <span
                        className="editor-file-picker-icon"
                        aria-hidden="true"
                      >
                        <Icon icon={getFileIcon(entry, false)} />
                      </span>
                      <span className="editor-file-picker-entry">
                        <span className="editor-file-picker-name">
                          {entry.name}
                        </span>
                        {parentPath && (
                          <span className="editor-file-picker-path">
                            {parentPath}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })
              ) : (
                <span className="editor-file-picker-empty">
                  No files are available.
                </span>
              )}
            </ScrollbarPanel>
          </div>
        </div>
      )}
    </div>
  );
};

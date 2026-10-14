import type { FC } from 'react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { getEntryPath } from './editorLayoutStorage';

interface EditorTabsProps {
  group: 'primary' | 'secondary';
  entries: RoomEntry[];
  fileIds: string[];
  selectedFileId: string | null;
  fileDiagnostics?: Record<string, 'error' | 'warning'>;
  onSelectFile: (fileId: string) => void;
  onCloseFile: (fileId: string) => void;
  onSplitWorkspace?: () => void;
  onCloseGroup?: () => void;
}

export const EditorTabs: FC<EditorTabsProps> = ({
  group,
  entries,
  fileIds,
  selectedFileId,
  fileDiagnostics,
  onSelectFile,
  onCloseFile,
  onSplitWorkspace,
  onCloseGroup,
}) => {
  return (
    <div
      className="editor-file-tabs"
      role="tablist"
      aria-label={`${group} editor files`}
    >
      {fileIds.map((fileId) => {
        const entry = entries.find(
          (item) => item.id === fileId && !item.isFolder
        );
        if (!entry) return null;
        const isActive = fileId === selectedFileId;
        const diagnostic = fileDiagnostics?.[fileId];
        const diagnosticClass =
          diagnostic === 'error'
            ? ' has-error'
            : diagnostic === 'warning'
              ? ' has-warning'
              : '';
        const filePath = getEntryPath(entry, entries);
        const title =
          diagnostic === 'error'
            ? `${filePath} (contains errors)`
            : diagnostic === 'warning'
              ? `${filePath} (contains warnings)`
              : filePath;

        return (
          <div
            className={`editor-file-tab${isActive ? ' is-active' : ''}${diagnosticClass}`}
            key={fileId}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelectFile(fileId)}
              title={title}
            >
              {entry.name}
            </button>
            <button
              type="button"
              className="editor-file-tab-close"
              aria-label={`Close ${entry.name}`}
              onClick={() => onCloseFile(fileId)}
            >
              ×
            </button>
          </div>
        );
      })}
      <div className="editor-group-actions">
        {group === 'primary' ? (
          <button
            type="button"
            title="Split workspace"
            aria-label="Split workspace"
            onClick={onSplitWorkspace}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect
                x="1.5"
                y="2"
                width="13"
                height="12"
                fill="none"
                stroke="currentColor"
              />
              <path d="M8 2v12" stroke="currentColor" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            title="Close editor group"
            aria-label="Close editor group"
            onClick={onCloseGroup}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
};

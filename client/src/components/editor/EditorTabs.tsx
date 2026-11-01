import type { FC } from 'react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import type {
  GithubChangeReviewTab,
  GithubChangeStatus,
} from '../../github/changeTracker';
import { EditorFileTab } from './EditorFileTab';
import { getEntryPath } from './editorLayoutStorage';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';

export interface EditorTabsProps {
  group: string;
  entries: RoomEntry[];
  fileIds: string[];
  selectedFileId: string | null;
  fileDiagnostics?: Record<string, 'error' | 'warning'>;
  fileProblemCounts?: Record<string, number>;
  reviewTabs?: GithubChangeReviewTab[];
  sourceControlChanges?: GithubChangeStatus[];
  onSelectFile: (fileId: string) => void;
  onCloseFile: (fileId: string) => void;
  onSplitWorkspace?: () => void;
  canSplitWorkspace: boolean;
  canCloseGroup: boolean;
  onCloseGroup?: () => void;
}

export const EditorTabs: FC<EditorTabsProps> = ({
  group,
  entries,
  fileIds,
  selectedFileId,
  fileDiagnostics,
  fileProblemCounts,
  reviewTabs = [],
  sourceControlChanges = [],
  onSelectFile,
  onCloseFile,
  onSplitWorkspace,
  canSplitWorkspace,
  canCloseGroup,
  onCloseGroup,
}) => {
  return (
    <ScrollbarPanel
      orientation="horizontal"
      className="editor-file-tabs"
      role="tablist"
      aria-label={`${group} editor files`}
    >
      {fileIds.map((fileId) => {
        const entry = entries.find(
          (item) => item.id === fileId && !item.isFolder
        );
        const reviewTab = reviewTabs.find((tab) => tab.id === fileId);
        const reviewEntry = reviewTab
          ? entries.find(
              (item) =>
                !item.isFolder &&
                getEntryPath(item, entries) === reviewTab.change.path
            )
          : undefined;
        const diagnosticFileId = entry?.id ?? reviewEntry?.id ?? fileId;
        return (
          <EditorFileTab
            key={fileId}
            fileId={fileId}
            entry={entry}
            reviewTab={reviewTab}
            entries={entries}
            selected={fileId === selectedFileId}
            diagnostic={fileDiagnostics?.[diagnosticFileId]}
            problemCount={fileProblemCounts?.[diagnosticFileId]}
            sourceControlChanges={sourceControlChanges}
            onSelect={onSelectFile}
            onClose={onCloseFile}
          />
        );
      })}
      <div className="editor-group-actions">
        {canSplitWorkspace && (
          <button
            type="button"
            title="Split editor group right"
            aria-label="Split editor group right"
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
        )}
        {canCloseGroup && (
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
    </ScrollbarPanel>
  );
};

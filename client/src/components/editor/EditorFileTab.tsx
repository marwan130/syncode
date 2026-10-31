import type { DragEvent } from 'react';
import { Icon } from '@iconify/react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import type {
  GithubChangeReviewTab,
  GithubChangeStatus,
} from '../../github/changeTracker';
import { getEntryPath } from './editorLayoutStorage';
import { getFileIcon, getFileStatusTone } from './fileExplorerUtils';
import { FileExplorerGitIndicator } from './FileExplorerGitIndicator';
import { FileProblemCount } from './FileProblemCount';

export interface EditorFileTabProps {
  fileId: string;
  entry?: RoomEntry;
  reviewTab?: GithubChangeReviewTab;
  entries: RoomEntry[];
  selected: boolean;
  diagnostic?: 'error' | 'warning';
  problemCount?: number;
  sourceControlChanges: GithubChangeStatus[];
  onSelect: (fileId: string) => void;
  onClose: (fileId: string) => void;
}

export function EditorFileTab({
  fileId,
  entry,
  reviewTab,
  entries,
  selected,
  diagnostic,
  problemCount,
  sourceControlChanges,
  onSelect,
  onClose,
}: EditorFileTabProps) {
  if (reviewTab) {
    return (
      <ReviewFileTab
        fileId={fileId}
        tab={reviewTab}
        selected={selected}
        problemCount={problemCount}
        onSelect={onSelect}
        onClose={onClose}
      />
    );
  }

  if (!entry || entry.isFolder) return null;

  const filePath = getEntryPath(entry, entries);
  const fileChange = sourceControlChanges.find(
    (change) => filePath === change.path
  );
  const statusTone = getFileStatusTone(diagnostic, fileChange?.kind);

  return (
    <div
      className={`editor-file-tab${selected ? ' is-active' : ''}${statusTone ? ` has-${statusTone}` : ''}`}
      key={fileId}
      draggable
      onDragStart={(event) => setFileDragData(event, fileId)}
    >
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        onClick={() => onSelect(fileId)}
        title={getWorkspaceFileTitle(filePath, diagnostic, fileChange)}
      >
        <Icon
          className="file-explorer-icon"
          icon={getFileIcon(entry, false)}
          aria-hidden="true"
        />
        <span className="editor-file-tab-name">{entry.name}</span>
        <FileProblemCount count={problemCount} />
        {fileChange && (
          <FileExplorerGitIndicator
            status={{ kind: fileChange.kind, changeCount: 1 }}
            hasProblem={Boolean(diagnostic || problemCount)}
          />
        )}
      </button>
      <button
        type="button"
        className="editor-file-tab-close"
        aria-label={`Close ${entry.name}`}
        onClick={() => onClose(fileId)}
      >
        ×
      </button>
    </div>
  );
}

function ReviewFileTab({
  fileId,
  tab,
  selected,
  problemCount,
  onSelect,
  onClose,
}: {
  fileId: string;
  tab: GithubChangeReviewTab;
  selected: boolean;
  problemCount?: number;
  onSelect: (fileId: string) => void;
  onClose: (fileId: string) => void;
}) {
  const name = tab.change.path.split('/').at(-1) ?? tab.change.path;
  const statusTone = getFileStatusTone(undefined, tab.change.kind);

  return (
    <div
      className={`editor-file-tab${selected ? ' is-active' : ''}${statusTone ? ` has-${statusTone}` : ''}`}
      key={fileId}
    >
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        onClick={() => onSelect(fileId)}
        title={`${tab.change.path} (${tab.change.kind})`}
      >
        <Icon
          className="file-explorer-icon"
          icon={getFileIcon({ name, isFolder: false }, false)}
          aria-hidden="true"
        />
        <span className="editor-file-tab-name">{name} (Working Tree)</span>
        <FileProblemCount count={problemCount} />
        <FileExplorerGitIndicator
          status={{ kind: tab.change.kind, changeCount: 1 }}
          hasProblem={Boolean(problemCount)}
        />
      </button>
      <button
        type="button"
        className="editor-file-tab-close"
        aria-label={`Close ${name} working tree diff`}
        onClick={() => onClose(fileId)}
      >
        ×
      </button>
    </div>
  );
}

function getWorkspaceFileTitle(
  filePath: string,
  diagnostic: 'error' | 'warning' | undefined,
  fileChange: GithubChangeStatus | undefined
): string {
  if (diagnostic === 'error') return `${filePath} (contains errors)`;
  if (diagnostic === 'warning') return `${filePath} (contains warnings)`;
  return fileChange ? `${filePath} (${fileChange.kind})` : filePath;
}

function setFileDragData(event: DragEvent<HTMLDivElement>, fileId: string) {
  event.dataTransfer.setData('application/x-syncode-file-id', fileId);
  event.dataTransfer.effectAllowed = 'move';
}

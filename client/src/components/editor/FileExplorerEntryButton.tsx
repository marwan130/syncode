import type { FC, KeyboardEvent } from 'react';
import { Icon } from '@iconify/react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { getFileExplorerIndent, getFileIcon } from './fileExplorerUtils';
import { getExplorerNavigationAction } from './fileExplorerKeyboard';
import type { FileExplorerGitStatus } from './fileExplorerUtils';
import { FileExplorerGitIndicator } from './FileExplorerGitIndicator';

export interface FileExplorerEntryButtonProps {
  entry: RoomEntry;
  depth: number;
  isExpanded: boolean;
  diagnostic?: 'error' | 'warning';
  diagnosticHint?: string;
  gitStatus?: FileExplorerGitStatus;
  onToggleFolder: (id: string) => void;
  onSelect: (id: string) => void;
  onOpenContextMenu: (x: number, y: number) => void;
}

function focusEntry(
  event: KeyboardEvent<HTMLButtonElement>,
  key: 'first' | 'last' | 'next' | 'previous'
) {
  const buttons = Array.from(
    event.currentTarget
      .closest('.file-explorer')
      ?.querySelectorAll<HTMLButtonElement>('.file-explorer-select') ?? []
  );
  const index = buttons.indexOf(event.currentTarget);
  const targetIndex =
    key === 'first'
      ? 0
      : key === 'last'
        ? buttons.length - 1
        : Math.max(
            0,
            Math.min(buttons.length - 1, index + (key === 'next' ? 1 : -1))
          );
  buttons[targetIndex]?.focus();
}

function handleKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  props: FileExplorerEntryButtonProps
) {
  const { entry, depth, isExpanded, onToggleFolder, onOpenContextMenu } = props;
  if (
    event.key === 'ContextMenu' ||
    (event.key === 'F10' && event.shiftKey)
  ) {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    onOpenContextMenu(bounds.left, bounds.bottom);
    return;
  }
  const action = getExplorerNavigationAction(
    event.key,
    entry.isFolder,
    isExpanded,
    depth
  );
  if (!action) return;
  event.preventDefault();

  if (
    action === 'first' ||
    action === 'last' ||
    action === 'next' ||
    action === 'previous'
  ) {
    focusEntry(event, action);
  } else if (action === 'expand' || action === 'collapse') {
    onToggleFolder(entry.id);
  } else if (action === 'focus-next') {
    focusEntry(event, 'next');
  } else if (action === 'focus-parent') {
    event.currentTarget
      .closest('ul[role="group"]')
      ?.closest('li[role="treeitem"]')
      ?.querySelector<HTMLButtonElement>(
        ':scope > .file-explorer-row .file-explorer-select'
      )
      ?.focus();
  }
}

export const FileExplorerEntryButton: FC<FileExplorerEntryButtonProps> = (
  props
) => {
  const {
    entry,
    depth,
    isExpanded,
    diagnostic,
    diagnosticHint,
    gitStatus,
    onToggleFolder,
    onSelect,
  } = props;
  const gitStatusHint = gitStatus
    ? `${gitStatus.changeCount} ${gitStatus.kind} ${gitStatus.changeCount === 1 ? 'change' : 'changes'}, ${gitStatus.stagedCount} staged`
    : undefined;
  const entryHints = [diagnosticHint, gitStatusHint].filter(Boolean).join('. ');
  return (
    <button
      className="file-explorer-select"
      type="button"
      style={{ paddingLeft: getFileExplorerIndent(depth) }}
      onClick={() =>
        entry.isFolder ? onToggleFolder(entry.id) : onSelect(entry.id)
      }
      aria-expanded={entry.isFolder ? isExpanded : undefined}
      aria-label={`${entry.isFolder ? 'Folder' : 'File'} ${entry.name}${entryHints ? `. ${entryHints}` : ''}`}
      title={entryHints ? `${entry.name}: ${entryHints}` : entry.name}
      draggable={!entry.isFolder}
      onDragStart={(event) => {
        if (entry.isFolder) return;
        event.dataTransfer.setData('application/x-syncode-file-id', entry.id);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      onKeyDown={(event) => handleKeyDown(event, props)}
    >
      <Icon
        className="file-explorer-icon"
        icon={getFileIcon(entry, isExpanded)}
        aria-hidden="true"
      />
      <span
        className={`file-explorer-name${diagnostic ? ` has-${diagnostic}` : ''}`}
      >
        {entry.name}
      </span>
      {diagnostic && (
        <span
          className={`file-explorer-diagnostic is-${diagnostic}`}
          aria-hidden="true"
        />
      )}
      <FileExplorerGitIndicator status={gitStatus} aggregate={entry.isFolder} />
    </button>
  );
};

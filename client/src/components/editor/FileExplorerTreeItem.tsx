import type { FC } from 'react';
import { Icon } from '@iconify/react';
import { ExplorerActionButton } from './ExplorerActionButton';
import { getFileIcon, getMovableEntry } from './fileExplorerUtils';
import { FileExplorerEntryButton } from './FileExplorerEntryButton';
import type { FileExplorerTreeItemProps } from './fileExplorerTypes';

export const FileExplorerTreeItem: FC<FileExplorerTreeItemProps> = ({
  entry,
  depth,
  nestedChildren,
  ...treeProps
}) => {
  const {
    onMove,
    entries,
    selectedEntryId,
    canEdit,
    expandedFolders,
    diagnosticsByEntry,
    editing,
    editError,
    renderNameInput,
    onToggleFolder,
    onStartCreate,
    onStartRename,
    onDelete,
    onSelect,
  } = treeProps;
  const isExpanded = expandedFolders.has(entry.id);
  const diagnostic = diagnosticsByEntry[entry.id];
  const diagnosticHint = diagnostic
    ? entry.isFolder
      ? diagnostic === 'error'
        ? 'Contains an error that needs attention'
        : 'Contains a warning that may need attention'
      : diagnostic === 'error'
        ? 'Has an error that needs attention'
        : 'Has a warning that may need attention'
    : undefined;
  const isRenaming =
    editing?.kind === 'rename' && editing.entry.id === entry.id;

  return (
    <li
      role="treeitem"
      aria-expanded={entry.isFolder ? isExpanded : undefined}
      draggable={canEdit}
      onDragStart={(event) =>
        event.dataTransfer.setData('text/plain', entry.id)
      }
      onDragOver={(event) => {
        if (canEdit && entry.isFolder) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!canEdit || !entry.isFolder) return;
        event.preventDefault();
        event.stopPropagation();
        const sourceEntry = getMovableEntry(
          entries,
          event.dataTransfer.getData('text/plain'),
          entry.id
        );
        if (sourceEntry) void onMove(sourceEntry, entry.id);
      }}
    >
      <div
        className={`file-explorer-row${entry.id === selectedEntryId ? ' is-active' : ''}`}
      >
        {isRenaming ? (
          <div
            className="file-explorer-editing-content"
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <Icon
              className="file-explorer-icon"
              icon={getFileIcon(entry, isExpanded)}
              aria-hidden="true"
            />
            {renderNameInput(`Rename ${entry.isFolder ? 'folder' : 'file'}`)}
          </div>
        ) : (
          <FileExplorerEntryButton
            entry={entry}
            depth={depth}
            isExpanded={isExpanded}
            diagnostic={diagnostic}
            diagnosticHint={diagnosticHint}
            onToggleFolder={onToggleFolder}
            onSelect={onSelect}
          />
        )}
        {!isRenaming && (
          <div className="file-explorer-actions">
            {entry.isFolder && (
              <>
                <ExplorerActionButton
                  kind="new-file"
                  label="New file"
                  disabled={!canEdit}
                  onClick={() => onStartCreate(entry.id, false)}
                />
                <ExplorerActionButton
                  kind="new-folder"
                  label="New folder"
                  disabled={!canEdit}
                  onClick={() => onStartCreate(entry.id, true)}
                />
              </>
            )}
            <ExplorerActionButton
              kind="rename"
              label={`Rename ${entry.name}`}
              disabled={!canEdit}
              onClick={() => onStartRename(entry)}
            />
            <ExplorerActionButton
              kind="delete"
              label={`Delete ${entry.name}`}
              disabled={!canEdit}
              onClick={() => onDelete(entry)}
            />
          </div>
        )}
      </div>
      {isRenaming && editError && (
        <div className="file-explorer-edit-error" role="alert">
          {editError}
        </div>
      )}
      {nestedChildren}
    </li>
  );
};

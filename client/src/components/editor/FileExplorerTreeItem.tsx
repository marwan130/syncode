import { useState } from 'react';
import type { FC, MouseEvent } from 'react';
import { Icon } from '@iconify/react';
import {
  getFileExplorerIndent,
  getFileIcon,
  getMovableEntry,
} from './fileExplorerUtils';
import { FileExplorerEntryButton } from './FileExplorerEntryButton';
import { FileExplorerContextMenu } from './FileExplorerContextMenu';
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
    gitStatusByEntry,
    editing,
    editError,
    renderNameInput,
    onToggleFolder,
    onContextMenuSelect,
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
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const openContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (isRenaming) return;
    onContextMenuSelect(entry.id);
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

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
        onContextMenu={openContextMenu}
      >
        {isRenaming ? (
          <div
            className="file-explorer-editing-content"
            style={{ paddingLeft: getFileExplorerIndent(depth) }}
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
            gitStatus={gitStatusByEntry.get(entry.id)}
            onToggleFolder={onToggleFolder}
            onSelect={onSelect}
            onOpenContextMenu={(x, y) => {
              onContextMenuSelect(entry.id);
              setContextMenu({ x, y });
            }}
          />
        )}
      </div>
      {isRenaming && editError && (
        <div className="file-explorer-edit-error" role="alert">
          {editError}
        </div>
      )}
      {nestedChildren}
      {contextMenu && !isRenaming && (
        <FileExplorerContextMenu
          entry={entry}
          x={contextMenu.x}
          y={contextMenu.y}
          canEdit={canEdit}
          onOpen={() =>
            entry.isFolder ? onToggleFolder(entry.id) : onSelect(entry.id)
          }
          onCreate={(isFolder) =>
            onStartCreate(entry.id, isFolder)
          }
          onRename={() => onStartRename(entry)}
          onDelete={() => onDelete(entry)}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </li>
  );
};

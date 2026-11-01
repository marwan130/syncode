import type { FC } from 'react';
import { Icon } from '@iconify/react';
import { getFileExplorerIndent, getFileIcon } from './fileExplorerUtils';
import type { FileExplorerTreeNodeProps } from './fileExplorerTypes';
import { FileExplorerTreeItem } from './FileExplorerTreeItem';

export const FileExplorerTree: FC<FileExplorerTreeNodeProps> = (props) => {
  const { parentId, depth } = props;
  const { childrenByParent, editing, draftName, editError, renderNameInput } =
    props;
  const sharedProps = {
    entries: props.entries,
    childrenByParent,
    selectedEntryId: props.selectedEntryId,
    canEdit: props.canEdit,
    expandedFolders: props.expandedFolders,
    diagnosticsByEntry: props.diagnosticsByEntry,
    gitStatusByEntry: props.gitStatusByEntry,
    fileProblemCounts: props.fileProblemCounts,
    editing,
    draftName,
    editError,
    renderNameInput,
    onToggleFolder: props.onToggleFolder,
    onContextMenuSelect: props.onContextMenuSelect,
    onStartCreate: props.onStartCreate,
    onStartRename: props.onStartRename,
    onDelete: props.onDelete,
    onSelect: props.onSelect,
    onMove: props.onMove,
  };

  return (
    <>
      {editing?.kind === 'create' && editing.parentId === parentId && (
        <li key={`new-${parentId ?? 'root'}`} role="treeitem">
          <div
            className="file-explorer-row is-editing"
            style={{ paddingLeft: getFileExplorerIndent(depth) }}
          >
            <Icon
              className="file-explorer-icon"
              icon={getFileIcon(
                { name: draftName, isFolder: editing.isFolder },
                false
              )}
              aria-hidden="true"
            />
            {renderNameInput(
              `New ${editing.isFolder ? 'folder' : 'file'} name`
            )}
          </div>
          {editError && (
            <div className="file-explorer-edit-error" role="alert">
              {editError}
            </div>
          )}
        </li>
      )}
      {(childrenByParent.get(parentId) ?? []).map((entry) => (
        <FileExplorerTreeItem
          key={entry.id}
          entry={entry}
          depth={depth}
          nestedChildren={
            entry.isFolder && props.expandedFolders.has(entry.id) ? (
              <ul role="group">
                <FileExplorerTree
                  {...props}
                  parentId={entry.id}
                  depth={depth + 1}
                />
              </ul>
            ) : null
          }
          {...sharedProps}
        />
      ))}
    </>
  );
};

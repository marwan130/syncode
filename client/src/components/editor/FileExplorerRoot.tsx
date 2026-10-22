import type { DragEvent } from 'react';
import { Icon } from '@iconify/react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { ExplorerActionButton } from './ExplorerActionButton';
import { FileExplorerTree } from './FileExplorerTree';
import type { ExplorerNodeSharedProps } from './fileExplorerTypes';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';

export interface FileExplorerRootProps {
  tree: ExplorerNodeSharedProps;
  entries: RoomEntry[];
  selectedEntryId: string | null;
  isRootExpanded: boolean;
  canImportFolder: boolean;
  onImportFolder?: () => void;
  onSaveProject?: () => void;
  onToggleRoot: () => void;
  onDragOver: (event: DragEvent<HTMLLIElement>) => void;
  onDrop: (event: DragEvent<HTMLLIElement>) => void;
}

export function FileExplorerRoot({
  tree,
  entries,
  selectedEntryId,
  isRootExpanded,
  canImportFolder,
  onImportFolder,
  onSaveProject,
  onToggleRoot,
  onDragOver,
  onDrop,
}: FileExplorerRootProps) {
  return (
    <aside className="file-explorer" aria-label="File explorer">
      <div className="file-explorer-heading">
        <span>EXPLORER</span>
      </div>
      <ScrollbarPanel className="file-explorer-scroll-area">
        <ul role="tree" aria-label="Project files">
          <li
            className="file-explorer-root"
            role="treeitem"
            aria-expanded={isRootExpanded}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <div
              className={`file-explorer-row file-explorer-root-row${selectedEntryId === null ? ' is-active' : ''}`}
            >
              <button
                type="button"
                className="file-explorer-root-select"
                aria-expanded={isRootExpanded}
                onClick={onToggleRoot}
              >
                <Icon
                  className="file-explorer-icon"
                  icon={`vscode-icons:default-folder${isRootExpanded ? '-opened' : ''}`}
                  aria-hidden="true"
                />
                <span>SYNCODE</span>
              </button>
              <div className="file-explorer-actions is-visible">
                <ExplorerActionButton
                  kind="new-file"
                  label="New file"
                  disabled={!tree.canEdit}
                  onClick={() => tree.onStartCreate(null, false)}
                />
                <ExplorerActionButton
                  kind="new-folder"
                  label="New folder"
                  disabled={!tree.canEdit}
                  onClick={() => tree.onStartCreate(null, true)}
                />
                {onImportFolder && (
                  <ExplorerActionButton
                    kind="import-folder"
                    label={
                      canImportFolder
                        ? 'Import folder'
                        : 'Only the room creator can import a folder'
                    }
                    disabled={!tree.canEdit || !canImportFolder}
                    onClick={onImportFolder}
                  />
                )}
                {onSaveProject && (
                  <ExplorerActionButton
                    kind="save-project"
                    label="Save project files"
                    disabled={entries.every((entry) => entry.isFolder)}
                    onClick={onSaveProject}
                  />
                )}
              </div>
            </div>
            {isRootExpanded && (
              <ul role="group">
                <FileExplorerTree {...tree} parentId={null} depth={0} />
              </ul>
            )}
          </li>
        </ul>
      </ScrollbarPanel>
    </aside>
  );
}

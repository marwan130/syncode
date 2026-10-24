import type { DragEvent, ReactNode } from 'react';
import { Icon } from '@iconify/react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { FileExplorerRootActions } from './FileExplorerRootActions';
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
  githubAction?: ReactNode;
  githubStatus?: ReactNode;
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
  githubAction,
  githubStatus,
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
        <ul className="file-explorer-tree" role="tree" aria-label="Project files">
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
                aria-label={`${isRootExpanded ? 'Collapse' : 'Expand'} Syncode project`}
                onClick={onToggleRoot}
              >
                <Icon
                  className="file-explorer-root-chevron"
                  icon={`codicon:chevron-${isRootExpanded ? 'down' : 'right'}`}
                  aria-hidden="true"
                />
                <span>SYNCODE</span>
              </button>
              <FileExplorerRootActions
                tree={tree}
                entries={entries}
                canImportFolder={canImportFolder}
                onImportFolder={onImportFolder}
                onSaveProject={onSaveProject}
                githubAction={githubAction}
              />
            </div>
            {githubStatus}
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

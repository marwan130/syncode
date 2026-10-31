import type { DragEvent, FC } from 'react';
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
  onOpenFile?: () => void;
  onOpenGithub?: () => void;
  onSaveProject?: () => void;
  onRefresh?: () => void;
  workspaceName?: string;
  onToggleRoot: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

export const FileExplorerRoot: FC<FileExplorerRootProps> = ({
  tree,
  entries,
  isRootExpanded,
  canImportFolder,
  onImportFolder,
  onOpenFile,
  onOpenGithub,
  onSaveProject,
  onRefresh,
  workspaceName,
  onToggleRoot,
  onDragOver,
  onDrop,
}) => {
  const hasWorkspace =
    entries.length > 0 || Boolean(workspaceName) || tree.editing !== null;

  return (
    <aside className="file-explorer" aria-label="File explorer">
      <div className="file-explorer-heading">
        <span>EXPLORER</span>
      </div>

      <ScrollbarPanel className="file-explorer-scroll-area">
        {!hasWorkspace ? (
          <div className="file-explorer-section is-empty-state">
            <button
              type="button"
              className="file-explorer-section-header"
              aria-expanded={isRootExpanded}
              onClick={onToggleRoot}
            >
              <Icon
                className="file-explorer-section-chevron"
                icon={`codicon:chevron-${isRootExpanded ? 'down' : 'right'}`}
                aria-hidden="true"
              />
              <span className="file-explorer-section-title">
                NO FOLDER OPENED
              </span>
            </button>

            {isRootExpanded && (
              <div className="file-explorer-empty-body">
                <p className="file-explorer-empty-message">
                  You have not yet opened a folder.
                </p>
                {canImportFolder && onImportFolder && (
                  <button
                    type="button"
                    className="file-explorer-btn file-explorer-btn-primary"
                    onClick={onImportFolder}
                  >
                    Open Folder
                  </button>
                )}
                {canImportFolder && onOpenFile && (
                  <button
                    type="button"
                    className="file-explorer-btn file-explorer-btn-primary"
                    onClick={onOpenFile}
                  >
                    Open File
                  </button>
                )}
                <button
                  type="button"
                  className="file-explorer-btn file-explorer-btn-primary"
                  disabled={!tree.canEdit}
                  onClick={() => tree.onStartCreate(null, false)}
                >
                  New File
                </button>
                <p className="file-explorer-empty-message file-explorer-remote-message">
                  You can open a remote repository or pull request without
                  cloning.
                </p>
                {onOpenGithub && (
                  <button
                    type="button"
                    className="file-explorer-btn file-explorer-btn-primary"
                    disabled={!canImportFolder}
                    onClick={onOpenGithub}
                  >
                    Open Remote Repository
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div
            className="file-explorer-section is-workspace"
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <div className="file-explorer-section-header file-explorer-workspace-header">
              <button
                type="button"
                className="file-explorer-section-header-left"
                aria-expanded={isRootExpanded}
                onClick={onToggleRoot}
              >
                <Icon
                  className="file-explorer-section-chevron"
                  icon={`codicon:chevron-${isRootExpanded ? 'down' : 'right'}`}
                  aria-hidden="true"
                />
                <span className="file-explorer-section-title">
                  {workspaceName ?? 'WORKSPACE'}
                </span>
              </button>
              <FileExplorerRootActions
                tree={tree}
                entries={entries}
                canImportFolder={canImportFolder}
                onImportFolder={onImportFolder}
                onOpenGithub={onOpenGithub}
                onSaveProject={onSaveProject}
                onRefresh={onRefresh}
              />
            </div>

            {isRootExpanded &&
              (entries.length > 0 || tree.editing ? (
                <ul
                  className="file-explorer-tree"
                  role="tree"
                  aria-label="Project files"
                >
                  <FileExplorerTree {...tree} parentId={null} depth={0} />
                </ul>
              ) : (
                <p className="file-explorer-empty-message">
                  This folder is empty.
                </p>
              ))}
          </div>
        )}
      </ScrollbarPanel>
    </aside>
  );
};

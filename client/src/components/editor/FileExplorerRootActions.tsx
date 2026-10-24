import type { ReactNode } from 'react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { ExplorerActionButton } from './ExplorerActionButton';
import type { ExplorerNodeSharedProps } from './fileExplorerTypes';

export interface FileExplorerRootActionsProps {
  tree: ExplorerNodeSharedProps;
  entries: RoomEntry[];
  canImportFolder: boolean;
  onImportFolder?: () => void;
  onSaveProject?: () => void;
  githubAction?: ReactNode;
}

export function FileExplorerRootActions({
  tree,
  entries,
  canImportFolder,
  onImportFolder,
  onSaveProject,
  githubAction,
}: FileExplorerRootActionsProps) {
  return (
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
      <FileExplorerImportAction
        tree={tree}
        canImportFolder={canImportFolder}
        onImportFolder={onImportFolder}
      />
      {githubAction}
      <FileExplorerSaveAction entries={entries} onSaveProject={onSaveProject} />
    </div>
  );
}

function FileExplorerImportAction({
  tree,
  canImportFolder,
  onImportFolder,
}: Pick<
  FileExplorerRootActionsProps,
  'tree' | 'canImportFolder' | 'onImportFolder'
>) {
  if (!onImportFolder) return null;
  return (
    <ExplorerActionButton
      kind="import-folder"
      label={
        canImportFolder
          ? 'Import folder'
          : 'Only room admins can import a folder'
      }
      disabled={!tree.canEdit || !canImportFolder}
      onClick={onImportFolder}
    />
  );
}

function FileExplorerSaveAction({
  entries,
  onSaveProject,
}: Pick<FileExplorerRootActionsProps, 'entries' | 'onSaveProject'>) {
  if (!onSaveProject) return null;
  return (
    <ExplorerActionButton
      kind="save-project"
      label="Save project files"
      disabled={entries.every((entry) => entry.isFolder)}
      onClick={onSaveProject}
    />
  );
}

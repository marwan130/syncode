import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { ExplorerActionButton } from './ExplorerActionButton';
import type { ExplorerNodeSharedProps } from './fileExplorerTypes';

export interface FileExplorerRootActionsProps {
  tree: ExplorerNodeSharedProps;
  entries: RoomEntry[];
  canImportFolder: boolean;
  onImportFolder?: () => void;
  onOpenGithub?: () => void;
  onSaveProject?: () => void;
  onRefresh?: () => void;
}

export function FileExplorerRootActions({
  tree,
  entries,
  canImportFolder,
  onImportFolder,
  onOpenGithub,
  onSaveProject,
  onRefresh,
}: FileExplorerRootActionsProps) {
  return (
    <div className="file-explorer-actions is-visible">
      <ExplorerActionButton
        kind="new-file"
        label="New File..."
        disabled={!tree.canEdit}
        onClick={() => tree.onStartCreate(null, false)}
      />
      <ExplorerActionButton
        kind="new-folder"
        label="New Folder..."
        disabled={!tree.canEdit}
        onClick={() => tree.onStartCreate(null, true)}
      />
      {onRefresh && (
        <ExplorerActionButton
          kind="refresh"
          label="Refresh Explorer"
          onClick={onRefresh}
        />
      )}
      <FileExplorerImportAction
        tree={tree}
        canImportFolder={canImportFolder}
        onImportFolder={onImportFolder}
      />
      {onOpenGithub && (
        <ExplorerActionButton
          kind="github-repository"
          label={
            canImportFolder
              ? 'Open GitHub Repository...'
              : 'Only room admins can open a GitHub repository'
          }
          disabled={!canImportFolder}
          onClick={onOpenGithub}
        />
      )}
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
      kind="open-folder"
      label={
        canImportFolder
          ? 'Open Folder...'
          : 'Only room admins can open a folder'
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

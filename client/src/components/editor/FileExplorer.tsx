import { useMemo, useState } from 'react';
import { addCollection } from '@iconify/react';
import { ImportFolderDialog } from '../project/ImportFolderDialog';
import vscodeFileIcons from './vscodeFileIcons.json';
import { createGithubRepositoryExplorerControls } from '../github/githubRepositoryExplorerControls';
import { FileExplorerRoot } from './FileExplorerRoot';
import type {
  FileExplorerProjectActions,
  ExplorerNodeSharedProps,
  GithubRepositoryExplorerProps,
  FileExplorerTreeProps,
} from './fileExplorerTypes';
import { useFileExplorerEditing } from './useFileExplorerEditing';
import { useFileExplorerMove } from './useFileExplorerMove';
import { useFileExplorerSelection } from './useFileExplorerSelection';
import {
  groupEntriesByParent,
  resolveFileExplorerGitStatus,
  resolveFileDiagnostics,
} from './fileExplorerUtils';

const NO_STAGED_PATHS: ReadonlySet<string> = new Set();

addCollection(vscodeFileIcons);

export function FileExplorer({
  entries,
  activeFileId,
  canEdit,
  fileDiagnostics,
  githubChanges = [],
  stagedPaths = NO_STAGED_PATHS,
  actions,
  projectActions,
}: FileExplorerTreeProps) {
  const {
    onSelect,
    onCreateEntry,
    onRename,
    onDelete,
    onMove,
  } = actions;
  const {
    canImportFolder,
    onImportFolder,
    onSaveProject,
    github,
  } = resolveProjectActions(projectActions);
  const selection = useFileExplorerSelection(activeFileId, onSelect);
  const [isImportDialogOpen, setImportDialogOpen] = useState(false);
  const moving = useFileExplorerMove({ entries, canEdit, onMove });
  const {
    draftName,
    editError,
    editing,
    renderNameInput,
    startCreate,
    startRename,
  } = useFileExplorerEditing({
    onCreateEntry,
    onRename,
    setExpandedFolders: selection.setExpandedFolders,
  });

  const childrenByParent = useMemo(
    () => groupEntriesByParent(entries),
    [entries]
  );
  const diagnosticsByEntry = useMemo(
    () => resolveFileDiagnostics(entries, childrenByParent, fileDiagnostics),
    [childrenByParent, entries, fileDiagnostics]
  );
  const gitStatusByEntry = useMemo(
    () => resolveFileExplorerGitStatus(entries, githubChanges, stagedPaths),
    [entries, githubChanges, stagedPaths]
  );
  const githubControls = getGithubExplorerControls(github, canEdit);

  const treeProps: ExplorerNodeSharedProps = {
    entries,
    childrenByParent,
    selectedEntryId: selection.selectedEntryId,
    canEdit,
    expandedFolders: selection.expandedFolders,
    diagnosticsByEntry,
    gitStatusByEntry,
    editing,
    draftName,
    editError,
    renderNameInput,
    onToggleFolder: selection.onToggleFolder,
    onContextMenuSelect: selection.onContextMenuSelect,
    onStartCreate: startCreate,
    onStartRename: startRename,
    onDelete,
    onSelect: selection.onSelect,
    onMove: moving.moveEntry,
  };
  const openImportDialog = getOpenImportDialog(
    onImportFolder,
    setImportDialogOpen
  );
  const saveProject = getSaveProjectAction(onSaveProject);

  return (
    <>
      <FileExplorerRoot
        tree={treeProps}
        entries={entries}
        selectedEntryId={selection.selectedEntryId}
        isRootExpanded={selection.isRootExpanded}
        canImportFolder={canImportFolder}
        onImportFolder={openImportDialog}
        onSaveProject={saveProject}
        githubAction={githubControls.action}
        githubStatus={githubControls.status}
        onToggleRoot={selection.onToggleRoot}
        onDragOver={moving.onDragOver}
        onDrop={moving.onRootDrop}
      />
      {renderImportDialog(onImportFolder, isImportDialogOpen, setImportDialogOpen)}
    </>
  );
}

function resolveProjectActions(projectActions: FileExplorerTreeProps['projectActions']) {
  return { ...projectActions, canImportFolder: projectActions?.canImportFolder ?? false };
}

function getGithubExplorerControls(
  github: GithubRepositoryExplorerProps | undefined,
  canEdit: boolean
) {
  if (!github) return { action: null, status: null };
  return createGithubRepositoryExplorerControls({
    ...github,
    canImport: github.canImport && canEdit,
  });
}

function getOpenImportDialog(
  onImportFolder: FileExplorerProjectActions['onImportFolder'],
  setImportDialogOpen: (open: boolean) => void
) {
  if (!onImportFolder) return undefined;
  return () => setImportDialogOpen(true);
}

function getSaveProjectAction(
  onSaveProject: FileExplorerProjectActions['onSaveProject']
) {
  if (!onSaveProject) return undefined;
  return () => void onSaveProject();
}

function renderImportDialog(
  onImportFolder: FileExplorerProjectActions['onImportFolder'],
  isImportDialogOpen: boolean,
  setImportDialogOpen: (open: boolean) => void
) {
  if (!onImportFolder) return null;
  return (
    <ImportFolderDialog
      isOpen={isImportDialogOpen}
      onClose={() => setImportDialogOpen(false)}
      onImport={onImportFolder}
    />
  );
}

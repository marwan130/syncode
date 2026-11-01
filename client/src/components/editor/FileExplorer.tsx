import { useEffect, useMemo, useRef } from 'react';
import { addCollection } from '@iconify/react';
import vscodeFileIcons from './vscodeFileIcons.json';
import { FileExplorerRoot } from './FileExplorerRoot';
import type {
  FileExplorerProjectActions,
  ExplorerNodeSharedProps,
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

addCollection(vscodeFileIcons);

export function FileExplorer({
  entries,
  projectRootName,
  activeFileId,
  canEdit,
  fileDiagnostics,
  fileProblemCounts,
  githubChanges = [],
  createFileNonce = 0,
  actions,
  projectActions,
}: FileExplorerTreeProps) {
  const { onSelect, onCreateEntry, onRename, onDelete, onMove } = actions;
  const {
    canImportFolder,
    onImportFolder,
    onOpenFile,
    onOpenGithub,
    onSaveProject,
    github,
  } = resolveProjectActions(projectActions);
  const selection = useFileExplorerSelection(activeFileId, onSelect);
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
    () => resolveFileExplorerGitStatus(entries, githubChanges),
    [entries, githubChanges]
  );

  const treeProps: ExplorerNodeSharedProps = {
    entries,
    childrenByParent,
    selectedEntryId: selection.selectedEntryId,
    canEdit,
    expandedFolders: selection.expandedFolders,
    diagnosticsByEntry,
    gitStatusByEntry,
    fileProblemCounts,
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
  const saveProject = getSaveProjectAction(onSaveProject);

  const lastCreateFileNonceRef = useRef(createFileNonce);

  useEffect(() => {
    if (createFileNonce > lastCreateFileNonceRef.current) {
      lastCreateFileNonceRef.current = createFileNonce;
      if (!selection.isRootExpanded) {
        selection.onToggleRoot();
      }
      startCreate(null, false);
    }
  }, [createFileNonce, selection, startCreate]);

  const workspaceName = useMemo(() => {
    if (projectRootName) return projectRootName;
    if (github?.baseline?.name) {
      return github.baseline.name;
    }
    const topFolder = entries.find((e) => e.parentId === null && e.isFolder);
    if (topFolder && entries.filter((e) => e.parentId === null).length === 1) {
      return topFolder.name;
    }
    return undefined;
  }, [entries, github, projectRootName]);

  return (
    <FileExplorerRoot
      tree={treeProps}
      entries={entries}
      selectedEntryId={selection.selectedEntryId}
      isRootExpanded={selection.isRootExpanded}
      canImportFolder={canImportFolder}
      onImportFolder={onImportFolder ? () => void onImportFolder() : undefined}
      onOpenFile={onOpenFile ? () => void onOpenFile() : undefined}
      onOpenGithub={onOpenGithub}
      onSaveProject={saveProject}
      workspaceName={workspaceName}
      onToggleRoot={selection.onToggleRoot}
      onDragOver={moving.onDragOver}
      onDrop={moving.onRootDrop}
    />
  );
}

function resolveProjectActions(
  projectActions: FileExplorerTreeProps['projectActions']
) {
  return {
    ...projectActions,
    canImportFolder: projectActions?.canImportFolder ?? false,
  };
}

function getSaveProjectAction(
  onSaveProject: FileExplorerProjectActions['onSaveProject']
) {
  if (!onSaveProject) return undefined;
  return () => void onSaveProject();
}

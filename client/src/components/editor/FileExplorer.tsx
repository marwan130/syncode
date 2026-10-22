import { useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { addCollection } from '@iconify/react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { ImportFolderDialog } from '../project/ImportFolderDialog';
import { userFacingError } from '../../utils/userFacingError';
import { useAppFeedback } from '../shared/useAppFeedback';
import vscodeFileIcons from './vscodeFileIcons.json';
import { FileExplorerRoot } from './FileExplorerRoot';
import type {
  ExplorerNodeSharedProps,
  FileExplorerTreeProps,
} from './fileExplorerTypes';
import { useFileExplorerEditing } from './useFileExplorerEditing';
import {
  groupEntriesByParent,
  getMovableEntry,
  resolveFileDiagnostics,
} from './fileExplorerUtils';

addCollection(vscodeFileIcons);

export function FileExplorer({
  entries,
  activeFileId,
  canEdit,
  fileDiagnostics,
  onSelect,
  onCreateEntry,
  onRename,
  onDelete,
  onMove,
  canImportFolder = false,
  onImportFolder,
  onSaveProject,
}: FileExplorerTreeProps) {
  const { showMessage } = useAppFeedback();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set()
  );
  const [isRootExpanded, setRootExpanded] = useState(true);
  const [selection, setSelection] = useState(() => ({
    id: activeFileId || null,
    activeFileId,
  }));
  const selectedEntryId =
    selection.activeFileId === activeFileId
      ? selection.id
      : activeFileId || null;
  const [isImportDialogOpen, setImportDialogOpen] = useState(false);
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
    setExpandedFolders,
  });

  const childrenByParent = useMemo(
    () => groupEntriesByParent(entries),
    [entries]
  );
  const diagnosticsByEntry = useMemo(
    () => resolveFileDiagnostics(entries, childrenByParent, fileDiagnostics),
    [childrenByParent, entries, fileDiagnostics]
  );

  const toggleFolder = (id: string) => {
    setExpandedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectEntry = (id: string | null) => {
    setSelection({ id, activeFileId });
  };

  const moveEntry = (entry: RoomEntry, parentId: string | null) =>
    onMove(entry, parentId).catch((error: unknown) => {
      void showMessage(
        userFacingError(error, 'Could not move that file or folder.')
      );
    });

  const handleDrop = (event: DragEvent, parentId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canEdit) return;
    const entry = getMovableEntry(
      entries,
      event.dataTransfer.getData('text/plain'),
      parentId
    );
    if (!entry) return;
    void moveEntry(entry, parentId);
  };

  const treeProps: ExplorerNodeSharedProps = {
    entries,
    childrenByParent,
    selectedEntryId,
    canEdit,
    expandedFolders,
    diagnosticsByEntry,
    editing,
    draftName,
    editError,
    renderNameInput,
    onToggleFolder: (id) => {
      selectEntry(id);
      toggleFolder(id);
    },
    onStartCreate: startCreate,
    onStartRename: startRename,
    onDelete,
    onSelect: (id) => {
      selectEntry(id);
      onSelect(id);
    },
    onMove: moveEntry,
  };

  return (
    <>
      <FileExplorerRoot
        tree={treeProps}
        entries={entries}
        selectedEntryId={selectedEntryId}
        isRootExpanded={isRootExpanded}
        canImportFolder={canImportFolder}
        onImportFolder={
          onImportFolder ? () => setImportDialogOpen(true) : undefined
        }
        onSaveProject={onSaveProject ? () => void onSaveProject() : undefined}
        onToggleRoot={() => {
          selectEntry(null);
          setRootExpanded((expanded) => !expanded);
        }}
        onDragOver={(event) => {
          if (canEdit) event.preventDefault();
        }}
        onDrop={(event) => handleDrop(event, null)}
      />
      {onImportFolder && (
        <ImportFolderDialog
          isOpen={isImportDialogOpen}
          onClose={() => setImportDialogOpen(false)}
          onImport={onImportFolder}
        />
      )}
    </>
  );
}

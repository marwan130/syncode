import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Icon, addCollection } from '@iconify/react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';
import { userFacingError } from '../../utils/userFacingError';
import vscodeFileIcons from './vscodeFileIcons.json';
import { ExplorerActionButton } from './ExplorerActionButton';
import { FileExplorerTree } from './FileExplorerTree';
import type {
  FileExplorerEdit,
  FileExplorerTreeProps,
} from './fileExplorerTypes';
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
}: FileExplorerTreeProps) {
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
  const [editing, setEditing] = useState<FileExplorerEdit>(null);
  const [draftName, setDraftName] = useState('');
  const [editError, setEditError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommit = useRef(false);
  const savingRef = useRef(false);

  const startCreate = (parentId: string | null, isFolder: boolean) => {
    skipBlurCommit.current = false;
    savingRef.current = false;
    if (parentId)
      setExpandedFolders((current) => new Set(current).add(parentId));
    setDraftName('');
    setEditError('');
    setEditing({ kind: 'create', parentId, isFolder });
  };

  const startRename = (entry: RoomEntry) => {
    skipBlurCommit.current = false;
    savingRef.current = false;
    setDraftName(entry.name);
    setEditError('');
    setEditing({ kind: 'rename', entry });
  };

  const cancelEdit = useCallback(() => {
    if (savingRef.current) return;
    skipBlurCommit.current = true;
    setEditing(null);
    setDraftName('');
    setEditError('');
  }, []);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    if (editing.kind === 'rename') inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (editing?.kind !== 'create') return;
    const cancelWhenClickingOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('.file-explorer-row.is-editing')) return;
      cancelEdit();
    };

    document.addEventListener('pointerdown', cancelWhenClickingOutside, true);
    return () => {
      document.removeEventListener(
        'pointerdown',
        cancelWhenClickingOutside,
        true
      );
    };
  }, [cancelEdit, editing]);

  const renderNameInput = (ariaLabel: string) => (
    <>
      <input
        ref={inputRef}
        className="file-explorer-inline-input"
        aria-label={ariaLabel}
        value={draftName}
        onChange={(event) => {
          setDraftName(event.target.value);
          setEditError('');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void submitEdit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelEdit();
          }
        }}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (
            nextTarget instanceof Node &&
            event.currentTarget.parentElement?.contains(nextTarget)
          ) {
            return;
          }
          if (skipBlurCommit.current) {
            skipBlurCommit.current = false;
            return;
          }
          if (editing?.kind === 'create') {
            cancelEdit();
          } else if (editing?.kind === 'rename') {
            if (draftName.trim()) void submitEdit();
            else cancelEdit();
          }
        }}
      />
      <div className="file-explorer-edit-actions">
        <button
          type="button"
          aria-label="Save name"
          title="Save name"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => void submitEdit()}
        >
          Save
        </button>
        {editing?.kind === 'rename' && (
          <button
            type="button"
            aria-label="Cancel name"
            title="Cancel"
            onPointerDown={(event) => event.preventDefault()}
            onClick={cancelEdit}
          >
            Cancel
          </button>
        )}
      </div>
    </>
  );

  const submitEdit = async () => {
    if (!editing || savingRef.current) return;
    const name = draftName.trim();
    if (!name) {
      setEditError('Enter a name.');
      inputRef.current?.focus();
      return;
    }
    savingRef.current = true;
    try {
      if (editing.kind === 'create') {
        const id = await onCreateEntry(
          editing.parentId,
          name,
          editing.isFolder
        );
        if (id && editing.isFolder)
          setExpandedFolders((current) => new Set(current).add(id));
      } else {
        await onRename(editing.entry, name);
      }
      setEditing(null);
      setDraftName('');
      setEditError('');
    } catch (error) {
      savingRef.current = false;
      setEditError(
        userFacingError(error, 'Could not save that file or folder name.')
      );
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

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
      window.alert(
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
            onDragOver={(event) => {
              if (canEdit) event.preventDefault();
            }}
            onDrop={(event) => handleDrop(event, null)}
          >
            <div
              className={`file-explorer-row file-explorer-root-row${selectedEntryId === null ? ' is-active' : ''}`}
            >
              <button
                type="button"
                className="file-explorer-root-select"
                aria-expanded={isRootExpanded}
                onClick={() => {
                  selectEntry(null);
                  setRootExpanded((expanded) => !expanded);
                }}
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
                  disabled={!canEdit}
                  onClick={() => startCreate(null, false)}
                />
                <ExplorerActionButton
                  kind="new-folder"
                  label="New folder"
                  disabled={!canEdit}
                  onClick={() => startCreate(null, true)}
                />
              </div>
            </div>
            {isRootExpanded && (
              <ul role="group">
                <FileExplorerTree
                  entries={entries}
                  parentId={null}
                  depth={0}
                  childrenByParent={childrenByParent}
                  selectedEntryId={selectedEntryId}
                  canEdit={canEdit}
                  expandedFolders={expandedFolders}
                  diagnosticsByEntry={diagnosticsByEntry}
                  editing={editing}
                  draftName={draftName}
                  editError={editError}
                  renderNameInput={renderNameInput}
                  onToggleFolder={(id) => {
                    selectEntry(id);
                    toggleFolder(id);
                  }}
                  onStartCreate={startCreate}
                  onStartRename={startRename}
                  onDelete={onDelete}
                  onSelect={(id) => {
                    selectEntry(id);
                    onSelect(id);
                  }}
                  onMove={moveEntry}
                />
              </ul>
            )}
          </li>
        </ul>
      </ScrollbarPanel>
    </aside>
  );
}

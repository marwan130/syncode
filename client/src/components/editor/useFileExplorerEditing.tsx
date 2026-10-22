import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { userFacingError } from '../../utils/userFacingError';
import type { FileExplorerEdit } from './fileExplorerTypes';

export interface UseFileExplorerEditingOptions {
  onCreateEntry: (
    parentId: string | null,
    name: string,
    isFolder: boolean
  ) => Promise<string | null | void>;
  onRename: (entry: RoomEntry, name: string) => Promise<void>;
  setExpandedFolders: Dispatch<SetStateAction<Set<string>>>;
}

export function useFileExplorerEditing({
  onCreateEntry,
  onRename,
  setExpandedFolders,
}: UseFileExplorerEditingOptions) {
  const [editing, setEditing] = useState<FileExplorerEdit>(null);
  const [draftName, setDraftName] = useState('');
  const [editError, setEditError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommit = useRef(false);
  const savingRef = useRef(false);

  const cancelEdit = useCallback(() => {
    if (savingRef.current) return;
    skipBlurCommit.current = true;
    setEditing(null);
    setDraftName('');
    setEditError('');
  }, []);

  const startCreate = useCallback(
    (parentId: string | null, isFolder: boolean) => {
      skipBlurCommit.current = false;
      savingRef.current = false;
      if (parentId)
        setExpandedFolders((current) => new Set(current).add(parentId));
      setDraftName('');
      setEditError('');
      setEditing({ kind: 'create', parentId, isFolder });
    },
    [setExpandedFolders]
  );

  const startRename = useCallback((entry: RoomEntry) => {
    skipBlurCommit.current = false;
    savingRef.current = false;
    setDraftName(entry.name);
    setEditError('');
    setEditing({ kind: 'rename', entry });
  }, []);

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

  return {
    cancelEdit,
    draftName,
    editError,
    editing,
    renderNameInput,
    startCreate,
    startRename,
  };
}

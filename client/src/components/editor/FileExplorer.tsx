import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon, addCollection } from '@iconify/react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';
import { userFacingError } from '../../utils/userFacingError';
import vscodeFileIcons from './vscodeFileIcons.json';

addCollection(vscodeFileIcons);

const EXTENSION_ICONS: Record<string, string> = {
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  env: 'dotenv',
  htm: 'html',
  html: 'html',
  java: 'java',
  js: 'js',
  cjs: 'js',
  mjs: 'js',
  json: 'json',
  md: 'markdown',
  py: 'python',
  pyw: 'python',
  rs: 'rust',
  sh: 'shell',
  bash: 'shell',
  svg: 'svg',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'reactjs',
  jsx: 'reactjs',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  txt: 'text',
};

function getFileIcon(
  entry: Pick<RoomEntry, 'name' | 'isFolder'>,
  expanded: boolean
): string {
  if (entry.isFolder)
    return `vscode-icons:default-folder${expanded ? '-opened' : ''}`;

  const name = entry.name.toLowerCase();
  if (name === 'dockerfile') return 'vscode-icons:file-type-docker';
  if (name === 'package.json') return 'vscode-icons:file-type-npm';
  const extension = name.split('.').pop() ?? '';
  return `vscode-icons:file-type-${EXTENSION_ICONS[extension] ?? 'text'}`;
}

interface FileExplorerProps {
  entries: RoomEntry[];
  activeFileId: string;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onCreateEntry: (
    parentId: string | null,
    name: string,
    isFolder: boolean
  ) => Promise<string | void>;
  onRename: (entry: RoomEntry, name: string) => Promise<void>;
  onDelete: (entry: RoomEntry) => void;
  fileDiagnostics?: Record<string, 'error' | 'warning'>;
}

export function FileExplorer({
  entries,
  activeFileId,
  canEdit,
  fileDiagnostics,
  onSelect,
  onCreateEntry,
  onRename,
  onDelete,
}: FileExplorerProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set()
  );
  const [editing, setEditing] = useState<
    | { kind: 'create'; parentId: string | null; isFolder: boolean }
    | { kind: 'rename'; entry: RoomEntry }
    | null
  >(null);
  const [draftName, setDraftName] = useState('');
  const [editError, setEditError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommit = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    if (editing.kind === 'rename') inputRef.current?.select();
  }, [editing]);

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

  const cancelEdit = () => {
    if (savingRef.current) return;
    skipBlurCommit.current = true;
    setEditing(null);
    setDraftName('');
    setEditError('');
  };

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

  const renderEditor = (key: string, depth: number, icon: string) => (
    <li key={key} role="treeitem">
      <div
        className="file-explorer-row is-editing"
        style={{ paddingLeft: 14 + depth * 14 }}
      >
        <Icon className="file-explorer-icon" icon={icon} aria-hidden="true" />
        {renderNameInput(
          `New ${editing?.kind === 'create' && editing.isFolder ? 'folder' : 'file'} name`
        )}
      </div>
      {editError && (
        <div className="file-explorer-edit-error" role="alert">
          {editError}
        </div>
      )}
    </li>
  );
  const childrenByParent = useMemo(() => {
    const children = new Map<string | null, RoomEntry[]>();
    for (const entry of entries) {
      const siblings = children.get(entry.parentId) ?? [];
      siblings.push(entry);
      children.set(entry.parentId, siblings);
    }
    for (const siblings of children.values()) {
      siblings.sort(
        (a, b) =>
          Number(b.isFolder) - Number(a.isFolder) ||
          a.name.localeCompare(b.name)
      );
    }
    return children;
  }, [entries]);

  // decorates folders with the highest-severity diagnostic found
  // anywhere beneath them
  const diagnosticsByEntry = useMemo(() => {
    const resolveDiagnostic = (
      entry: RoomEntry,
      ancestors: ReadonlySet<string> = new Set()
    ): 'error' | 'warning' | undefined => {
      let severity = fileDiagnostics?.[entry.id];
      if (!entry.isFolder || ancestors.has(entry.id)) return severity;

      const nextAncestors = new Set(ancestors);
      nextAncestors.add(entry.id);
      for (const child of childrenByParent.get(entry.id) ?? []) {
        const childSeverity = resolveDiagnostic(child, nextAncestors);
        if (childSeverity === 'error') return 'error';
        if (childSeverity === 'warning') severity = 'warning';
      }
      return severity;
    };

    return Object.fromEntries(
      entries.flatMap((entry) => {
        const severity = resolveDiagnostic(entry);
        return severity ? [[entry.id, severity]] : [];
      })
    );
  }, [childrenByParent, entries, fileDiagnostics]);

  const toggleFolder = (id: string) => {
    setExpandedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderChildren = (parentId: string | null, depth = 0): ReactNode => (
    <>
      {editing?.kind === 'create' &&
        editing.parentId === parentId &&
        renderEditor(
          `new-${parentId ?? 'root'}`,
          depth,
          getFileIcon({ name: draftName, isFolder: editing.isFolder }, false)
        )}
      {(childrenByParent.get(parentId) ?? []).map((entry) => {
        const isExpanded = expandedFolders.has(entry.id);
        const diagnostic = diagnosticsByEntry[entry.id];
        const diagnosticHint = diagnostic
          ? entry.isFolder
            ? diagnostic === 'error'
              ? 'Contains an error that needs attention'
              : 'Contains a warning that may need attention'
            : diagnostic === 'error'
              ? 'Has an error that needs attention'
              : 'Has a warning that may need attention'
          : undefined;
        const isRenaming =
          editing?.kind === 'rename' && editing.entry.id === entry.id;
        return (
          <li
            key={entry.id}
            role="treeitem"
            aria-expanded={entry.isFolder ? isExpanded : undefined}
          >
            <div
              className={`file-explorer-row${entry.id === activeFileId ? ' is-active' : ''}`}
            >
              {isRenaming ? (
                <div
                  className="file-explorer-editing-content"
                  style={{ paddingLeft: 8 + depth * 14 }}
                >
                  <Icon
                    className="file-explorer-icon"
                    icon={getFileIcon(entry, isExpanded)}
                    aria-hidden="true"
                  />
                  {renderNameInput(
                    `Rename ${entry.isFolder ? 'folder' : 'file'}`
                  )}
                </div>
              ) : (
                <button
                  className="file-explorer-select"
                  type="button"
                  style={{ paddingLeft: 8 + depth * 14 }}
                  onClick={() =>
                    entry.isFolder ? toggleFolder(entry.id) : onSelect(entry.id)
                  }
                  aria-expanded={entry.isFolder ? isExpanded : undefined}
                  aria-label={`${entry.isFolder ? 'Folder' : 'File'} ${entry.name}${diagnosticHint ? `. ${diagnosticHint}` : ''}`}
                  title={
                    diagnosticHint
                      ? `${entry.name}: ${diagnosticHint}`
                      : entry.name
                  }
                  draggable={!entry.isFolder}
                  onDragStart={(event) => {
                    if (entry.isFolder) return;
                    event.dataTransfer.setData(
                      'application/x-syncode-file-id',
                      entry.id
                    );
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  onKeyDown={(event) => {
                    const buttons = Array.from(
                      event.currentTarget
                        .closest('.file-explorer')
                        ?.querySelectorAll<HTMLButtonElement>(
                          '.file-explorer-select'
                        ) ?? []
                    );
                    const index = buttons.indexOf(event.currentTarget);
                    if (
                      event.key === 'ArrowDown' ||
                      event.key === 'ArrowUp' ||
                      event.key === 'Home' ||
                      event.key === 'End'
                    ) {
                      event.preventDefault();
                      const next =
                        event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? buttons.length - 1
                            : Math.max(
                                0,
                                Math.min(
                                  buttons.length - 1,
                                  index + (event.key === 'ArrowDown' ? 1 : -1)
                                )
                              );
                      buttons[next]?.focus();
                    } else if (event.key === 'ArrowRight' && entry.isFolder) {
                      event.preventDefault();
                      if (!isExpanded) toggleFolder(entry.id);
                      else buttons[index + 1]?.focus();
                    } else if (
                      event.key === 'ArrowLeft' &&
                      entry.isFolder &&
                      isExpanded
                    ) {
                      event.preventDefault();
                      toggleFolder(entry.id);
                    } else if (event.key === 'ArrowLeft' && depth > 0) {
                      event.preventDefault();
                      const parent = event.currentTarget
                        .closest('ul[role="group"]')
                        ?.closest('li[role="treeitem"]');
                      parent
                        ?.querySelector<HTMLButtonElement>(
                          ':scope > .file-explorer-row .file-explorer-select'
                        )
                        ?.focus();
                    }
                  }}
                >
                  <Icon
                    className="file-explorer-icon"
                    icon={getFileIcon(entry, isExpanded)}
                    aria-hidden="true"
                  />
                  <span
                    className={`file-explorer-name${diagnostic ? ` has-${diagnostic}` : ''}`}
                  >
                    {entry.name}
                  </span>
                  {diagnostic && (
                    <span
                      className={`file-explorer-diagnostic is-${diagnostic}`}
                      aria-hidden="true"
                    />
                  )}
                </button>
              )}
              {!isRenaming && (
                <div className="file-explorer-actions">
                  {entry.isFolder && (
                    <>
                      <button
                        type="button"
                        title="New file"
                        aria-label="New file"
                        disabled={!canEdit}
                        onClick={() => {
                          startCreate(entry.id, false);
                        }}
                      >
                        ＋
                      </button>
                      <button
                        type="button"
                        title="New folder"
                        aria-label="New folder"
                        disabled={!canEdit}
                        onClick={() => {
                          startCreate(entry.id, true);
                        }}
                      >
                        ▣
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    title={`Rename ${entry.name}`}
                    aria-label={`Rename ${entry.name}`}
                    disabled={!canEdit}
                    onClick={() => startRename(entry)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    title={`Delete ${entry.name}`}
                    aria-label={`Delete ${entry.name}`}
                    disabled={!canEdit}
                    onClick={() => onDelete(entry)}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
            {isRenaming && editError && (
              <div className="file-explorer-edit-error" role="alert">
                {editError}
              </div>
            )}
            {entry.isFolder && isExpanded && (
              <ul role="group">{renderChildren(entry.id, depth + 1)}</ul>
            )}
          </li>
        );
      })}
    </>
  );

  return (
    <aside className="file-explorer" aria-label="File explorer">
      <div className="file-explorer-heading">
        <span>EXPLORER</span>
        <div>
          <button
            type="button"
            title="New file"
            aria-label="New file"
            disabled={!canEdit}
            onClick={() => startCreate(null, false)}
          >
            ＋
          </button>
          <button
            type="button"
            title="New folder"
            aria-label="New folder"
            disabled={!canEdit}
            onClick={() => {
              startCreate(null, true);
            }}
          >
            ▣
          </button>
        </div>
      </div>
      <ScrollbarPanel className="file-explorer-scroll-area">
        <ul role="tree" aria-label="Project files">
          {renderChildren(null)}
        </ul>
      </ScrollbarPanel>
    </aside>
  );
}

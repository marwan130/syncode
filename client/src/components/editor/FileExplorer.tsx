import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon, addCollection } from '@iconify/react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
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

function getFileIcon(entry: RoomEntry, expanded: boolean): string {
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
  onSelect: (id: string) => void;
  onCreateFile: (parentId: string | null) => void;
  onCreateFolder: (parentId: string | null) => Promise<string | void>;
  onRename: (entry: RoomEntry) => void;
  onDelete: (entry: RoomEntry) => void;
  fileDiagnostics?: Record<string, 'error' | 'warning'>;
}

export function FileExplorer({
  entries,
  activeFileId,
  fileDiagnostics,
  onSelect,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
}: FileExplorerProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set()
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

  const toggleFolder = (id: string) => {
    setExpandedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderChildren = (parentId: string | null, depth = 0): ReactNode =>
    (childrenByParent.get(parentId) ?? []).map((entry) => {
      const isExpanded = expandedFolders.has(entry.id);
      return (
        <li
          key={entry.id}
          role="treeitem"
          aria-expanded={entry.isFolder ? isExpanded : undefined}
        >
          <div
            className={`file-explorer-row${entry.id === activeFileId ? ' is-active' : ''}`}
          >
            <button
              className="file-explorer-select"
              type="button"
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() =>
                entry.isFolder ? toggleFolder(entry.id) : onSelect(entry.id)
              }
              aria-expanded={entry.isFolder ? isExpanded : undefined}
              title={entry.name}
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
                className={`file-explorer-name${
                  fileDiagnostics?.[entry.id] === 'error'
                    ? ' has-error'
                    : fileDiagnostics?.[entry.id] === 'warning'
                      ? ' has-warning'
                      : ''
                }`}
              >
                {entry.name}
              </span>
            </button>
            <div className="file-explorer-actions">
              {entry.isFolder && (
                <>
                  <button
                    type="button"
                    title="New file"
                    aria-label="New file"
                    onClick={() => {
                      setExpandedFolders((current) =>
                        new Set(current).add(entry.id)
                      );
                      onCreateFile(entry.id);
                    }}
                  >
                    ＋
                  </button>
                  <button
                    type="button"
                    title="New folder"
                    aria-label="New folder"
                    onClick={() => {
                      setExpandedFolders((current) =>
                        new Set(current).add(entry.id)
                      );
                      void onCreateFolder(entry.id).then((id) => {
                        if (id)
                          setExpandedFolders((current) =>
                            new Set(current).add(id)
                          );
                      });
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
                onClick={() => onRename(entry)}
              >
                ✎
              </button>
              <button
                type="button"
                title={`Delete ${entry.name}`}
                aria-label={`Delete ${entry.name}`}
                onClick={() => onDelete(entry)}
              >
                ×
              </button>
            </div>
          </div>
          {entry.isFolder && isExpanded && (
            <ul role="group">{renderChildren(entry.id, depth + 1)}</ul>
          )}
        </li>
      );
    });

  return (
    <aside className="file-explorer" aria-label="File explorer">
      <div className="file-explorer-heading">
        <span>EXPLORER</span>
        <div>
          <button
            type="button"
            title="New file"
            aria-label="New file"
            onClick={() => onCreateFile(null)}
          >
            ＋
          </button>
          <button
            type="button"
            title="New folder"
            aria-label="New folder"
            onClick={() => {
              void onCreateFolder(null).then((id) => {
                if (id)
                  setExpandedFolders((current) => new Set(current).add(id));
              });
            }}
          >
            ▣
          </button>
        </div>
      </div>
      <ul role="tree" aria-label="Project files">
        {renderChildren(null)}
      </ul>
    </aside>
  );
}

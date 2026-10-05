import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';

interface FileExplorerProps {
  entries: RoomEntry[];
  activeFileId: string;
  onSelect: (id: string) => void;
  onCreateFile: (parentId: string | null) => void;
  onCreateFolder: (parentId: string | null) => Promise<string | void>;
  onRename: (entry: RoomEntry) => void;
  onDelete: (entry: RoomEntry) => void;
}

export function FileExplorer({
  entries,
  activeFileId,
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
        <li key={entry.id}>
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
            >
              <span className="file-explorer-icon" aria-hidden="true">
                {entry.isFolder
                  ? isExpanded
                    ? '▾'
                    : '▸'
                  : entry.name.split('.').pop()?.toUpperCase() || 'FILE'}
              </span>
              {entry.name}
            </button>
            <div className="file-explorer-actions">
              {entry.isFolder && (
                <>
                  <button
                    type="button"
                    title={`New file in ${entry.name}`}
                    aria-label={`New file in ${entry.name}`}
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
                    title={`New folder in ${entry.name}`}
                    aria-label={`New folder in ${entry.name}`}
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
            <ul>{renderChildren(entry.id, depth + 1)}</ul>
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
      <div className="file-explorer-room">ROOM FILES</div>
      <ul>{renderChildren(null)}</ul>
    </aside>
  );
}

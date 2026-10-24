import { useState } from 'react';

export function useFileExplorerSelection(
  activeFileId: string,
  onSelect: (id: string) => void
) {
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

  const selectEntry = (id: string | null) => {
    setSelection({ id, activeFileId });
  };

  const toggleFolder = (id: string) => {
    setExpandedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return {
    expandedFolders,
    setExpandedFolders,
    isRootExpanded,
    selectedEntryId,
    onToggleFolder: (id: string) => {
      selectEntry(id);
      toggleFolder(id);
    },
    onSelect: (id: string) => {
      selectEntry(id);
      onSelect(id);
    },
    onContextMenuSelect: (id: string) => selectEntry(id),
    onToggleRoot: () => {
      selectEntry(null);
      setRootExpanded((expanded) => !expanded);
    },
  };
}

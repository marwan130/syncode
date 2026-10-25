import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { useOutsidePointerDismiss } from '../../hooks/useOutsidePointerDismiss';

interface FileExplorerContextMenuProps {
  entry: RoomEntry;
  x: number;
  y: number;
  canEdit: boolean;
  onOpen: () => void;
  onCreate: (isFolder: boolean) => void;
  onRename: () => void;
  onDelete: () => void;
  onDismiss: () => void;
}

export function FileExplorerContextMenu({
  entry,
  x,
  y,
  canEdit,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onDismiss,
}: FileExplorerContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ x, y });

  useOutsidePointerDismiss(true, onDismiss, (target) =>
    Boolean(target && menuRef.current?.contains(target as Node))
  );

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  const runAction = (action: () => void) => {
    onDismiss();
    action();
  };

  const menu = (
    <div
      ref={menuRef}
      className="file-explorer-context-menu"
      role="menu"
      aria-label={`${entry.isFolder ? 'Folder' : 'File'} actions`}
      style={{ left: position.x, top: position.y }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onDismiss();
          return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]:not(:disabled)'
          ) ?? []
        );
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const currentIndex = index < 0 ? (direction > 0 ? -1 : 0) : index;
        items[(currentIndex + direction + items.length) % items.length]?.focus();
      }}
    >
      {entry.isFolder ? (
        <>
          <MenuItem
            ref={firstItemRef}
            label="New File..."
            disabled={!canEdit}
            onClick={() => runAction(() => onCreate(false))}
          />
          <MenuItem
            label="New Folder..."
            disabled={!canEdit}
            onClick={() => runAction(() => onCreate(true))}
          />
        </>
      ) : (
        <MenuItem
          ref={firstItemRef}
          label="Open"
          onClick={() => runAction(onOpen)}
        />
      )}
      <div className="file-explorer-context-separator" role="separator" />
      <MenuItem
        label="Rename..."
        disabled={!canEdit}
        onClick={() => runAction(onRename)}
      />
      <MenuItem
        label="Delete"
        disabled={!canEdit}
        onClick={() => runAction(onDelete)}
      />
    </div>
  );

  return createPortal(menu, document.body);
}

interface MenuItemProps {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

const MenuItem = forwardRef<
  HTMLButtonElement,
  MenuItemProps
>(function MenuItem({ label, disabled, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      className="file-explorer-context-item"
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
});

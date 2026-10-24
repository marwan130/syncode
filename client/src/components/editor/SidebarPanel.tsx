import type { ReactNode } from 'react';
import { ResizeHandle } from './ResizeHandle';
import {
  DEFAULT_EXPLORER_WIDTH,
  MIN_SIDE_PANEL_WIDTH,
  storeExplorerWidth,
} from './editorLayoutStorage';

interface SidebarPanelProps {
  isOpen: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  label: string;
  children: ReactNode;
}

export function SidebarPanel({
  isOpen,
  width,
  onWidthChange,
  onClose,
  label,
  children,
}: SidebarPanelProps) {
  if (!isOpen) return null;

  return (
    <>
      <div className="explorer-panel-sized" style={{ flexBasis: width }}>
        {children}
      </div>
      <ResizeHandle
        label={`Resize ${label}`}
        onResize={(delta) =>
          resizeSidebar(delta, width, onWidthChange, onClose)
        }
      />
    </>
  );
}

function resizeSidebar(
  delta: number,
  width: number,
  onWidthChange: (width: number) => void,
  onClose: () => void
): void {
  const next = width + delta;
  if (next < MIN_SIDE_PANEL_WIDTH) {
    onClose();
    onWidthChange(DEFAULT_EXPLORER_WIDTH);
    storeExplorerWidth(DEFAULT_EXPLORER_WIDTH);
    return;
  }

  const nextWidth = Math.min(600, next);
  onWidthChange(nextWidth);
  storeExplorerWidth(nextWidth);
}

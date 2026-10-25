import type { FC } from 'react';
import { FileExplorer } from './FileExplorer';
import { SidebarPanel } from './SidebarPanel';
import type { FileExplorerPanelProps } from './fileExplorerTypes';

export const FileExplorerPanel: FC<FileExplorerPanelProps> = ({
  isOpen,
  width,
  onWidthChange,
  onClose,
  ...explorerProps
}) => {
  return (
    <SidebarPanel
      isOpen={isOpen}
      width={width}
      onWidthChange={onWidthChange}
      onClose={onClose}
      label="file explorer"
    >
      <FileExplorer {...explorerProps} />
    </SidebarPanel>
  );
};

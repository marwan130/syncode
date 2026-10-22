import type { FC } from 'react';
import { FileExplorer } from './FileExplorer';
import { ResizeHandle } from './ResizeHandle';
import {
  DEFAULT_EXPLORER_WIDTH,
  MIN_SIDE_PANEL_WIDTH,
  storeExplorerWidth,
} from './editorLayoutStorage';
import type { FileExplorerPanelProps } from './fileExplorerTypes';

export const FileExplorerPanel: FC<FileExplorerPanelProps> = ({
  isOpen,
  width,
  entries,
  activeFileId,
  canEdit,
  fileDiagnostics,
  onWidthChange,
  onClose,
  onSelect,
  onCreateEntry,
  onRename,
  onDelete,
  onMove,
  canImportFolder,
  onImportFolder,
  onSaveProject,
}) => {
  if (!isOpen) return null;

  return (
    <>
      <div className="explorer-panel-sized" style={{ flexBasis: width }}>
        <FileExplorer
          entries={entries}
          activeFileId={activeFileId}
          canEdit={canEdit}
          fileDiagnostics={fileDiagnostics}
          onSelect={onSelect}
          onCreateEntry={onCreateEntry}
          onRename={onRename}
          onDelete={onDelete}
          onMove={onMove}
          canImportFolder={canImportFolder}
          onImportFolder={onImportFolder}
          onSaveProject={onSaveProject}
        />
      </div>
      <ResizeHandle
        label="Resize file explorer"
        onResize={(delta) => {
          const next = width + delta;
          if (next < MIN_SIDE_PANEL_WIDTH) {
            onClose();
            onWidthChange(DEFAULT_EXPLORER_WIDTH);
            storeExplorerWidth(DEFAULT_EXPLORER_WIDTH);
            return;
          }
          const nextWidth = Math.max(MIN_SIDE_PANEL_WIDTH, Math.min(600, next));
          onWidthChange(nextWidth);
          storeExplorerWidth(nextWidth);
        }}
      />
    </>
  );
};

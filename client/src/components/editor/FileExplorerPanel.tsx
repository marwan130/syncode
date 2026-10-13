import type { FC } from 'react';
import { FileExplorer } from './FileExplorer';
import { ResizeHandle } from './ResizeHandle';
import {
  DEFAULT_EXPLORER_WIDTH,
  storeExplorerWidth,
} from './editorLayoutStorage';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';

interface FileExplorerPanelProps {
  isOpen: boolean;
  width: number;
  entries: RoomEntry[];
  activeFileId: string;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onSelect: (fileId: string) => void;
  onCreateFile: (parentId: string | null) => Promise<string | void>;
  onCreateFolder: (parentId: string | null) => Promise<string | void>;
  onRename: (entry: RoomEntry) => void;
  onDelete: (entry: RoomEntry) => void;
  fileDiagnostics?: Record<string, 'error' | 'warning'>;
}

export const FileExplorerPanel: FC<FileExplorerPanelProps> = ({
  isOpen,
  width,
  entries,
  activeFileId,
  fileDiagnostics,
  onWidthChange,
  onClose,
  onSelect,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
}) => {
  if (!isOpen) return null;

  return (
    <>
      <div className="explorer-panel-sized" style={{ flexBasis: width }}>
        <FileExplorer
          entries={entries}
          activeFileId={activeFileId}
          fileDiagnostics={fileDiagnostics}
          onSelect={onSelect}
          onCreateFile={onCreateFile}
          onCreateFolder={onCreateFolder}
          onRename={onRename}
          onDelete={onDelete}
        />
      </div>
      <ResizeHandle
        label="Resize file explorer"
        onResize={(delta) => {
          const next = width + delta;
          if (next <= 32) {
            onClose();
            onWidthChange(DEFAULT_EXPLORER_WIDTH);
            storeExplorerWidth(DEFAULT_EXPLORER_WIDTH);
            return;
          }
          const nextWidth = Math.min(600, next);
          onWidthChange(nextWidth);
          storeExplorerWidth(nextWidth);
        }}
      />
    </>
  );
};

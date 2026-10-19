import type { ReactNode } from 'react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';

export interface ExplorerNodeSharedProps {
  entries: RoomEntry[];
  childrenByParent: Map<string | null, RoomEntry[]>;
  selectedEntryId: string | null;
  canEdit: boolean;
  expandedFolders: ReadonlySet<string>;
  diagnosticsByEntry: Record<string, 'error' | 'warning' | undefined>;
  editing: FileExplorerEdit;
  draftName: string;
  editError: string;
  renderNameInput: (ariaLabel: string) => ReactNode;
  onToggleFolder: (id: string) => void;
  onStartCreate: (parentId: string | null, isFolder: boolean) => void;
  onStartRename: (entry: RoomEntry) => void;
  onDelete: (entry: RoomEntry) => void;
  onSelect: (id: string) => void;
  onMove: (entry: RoomEntry, parentId: string | null) => Promise<void>;
}

export interface FileExplorerTreeNodeProps extends ExplorerNodeSharedProps {
  parentId: string | null;
  depth: number;
}

export type FileExplorerTreeItemProps = Omit<
  ExplorerNodeSharedProps,
  'childrenByParent'
> & {
  entry: RoomEntry;
  depth: number;
  nestedChildren: ReactNode;
};

export type FileExplorerEdit =
  | { kind: 'create'; parentId: string | null; isFolder: boolean }
  | { kind: 'rename'; entry: RoomEntry }
  | null;

export interface FileExplorerTreeProps {
  entries: RoomEntry[];
  activeFileId: string;
  canEdit: boolean;
  fileDiagnostics?: Record<string, 'error' | 'warning'>;
  onSelect: (id: string) => void;
  onCreateEntry: (
    parentId: string | null,
    name: string,
    isFolder: boolean
  ) => Promise<string | void>;
  onRename: (entry: RoomEntry, name: string) => Promise<void>;
  onDelete: (entry: RoomEntry) => void;
  onMove: (entry: RoomEntry, parentId: string | null) => Promise<void>;
}

export interface FileExplorerPanelProps extends FileExplorerTreeProps {
  isOpen: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

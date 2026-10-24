import type { ReactNode } from 'react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import type { ImportedFileContent } from '../../import/folderImport';
import type { GithubRepositoryBaseline } from '../../github/githubTypes';
import type { GithubChangeStatus } from '../../github/changeTracker';
import type { FileExplorerGitStatus } from './fileExplorerUtils';

export interface ExplorerNodeSharedProps {
  entries: RoomEntry[];
  childrenByParent: Map<string | null, RoomEntry[]>;
  selectedEntryId: string | null;
  canEdit: boolean;
  expandedFolders: ReadonlySet<string>;
  diagnosticsByEntry: Record<string, 'error' | 'warning' | undefined>;
  gitStatusByEntry: Map<string, FileExplorerGitStatus>;
  editing: FileExplorerEdit;
  draftName: string;
  editError: string;
  renderNameInput: (ariaLabel: string) => ReactNode;
  onToggleFolder: (id: string) => void;
  onContextMenuSelect: (id: string) => void;
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

export interface GithubRepositoryExplorerProps {
  roomId: string;
  accessKey: string;
  baseline: GithubRepositoryBaseline | null;
  changes: GithubChangeStatus[];
  canImport: boolean;
  onRequestAdminGrant: () => Promise<string>;
  onImport: (
    files: ImportedFileContent[],
    baseline: GithubRepositoryBaseline
  ) => Promise<void>;
  onBaselineChange: (baseline: GithubRepositoryBaseline) => void;
}

export interface FileExplorerTreeActions {
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

export interface FileExplorerProjectActions {
  canImportFolder?: boolean;
  onImportFolder?: (files: ImportedFileContent[]) => Promise<void>;
  onSaveProject?: () => Promise<void>;
  github?: GithubRepositoryExplorerProps;
}

export interface FileExplorerTreeProps {
  entries: RoomEntry[];
  activeFileId: string;
  canEdit: boolean;
  fileDiagnostics?: Record<string, 'error' | 'warning'>;
  githubChanges?: GithubChangeStatus[];
  stagedPaths?: ReadonlySet<string>;
  actions: FileExplorerTreeActions;
  projectActions?: FileExplorerProjectActions;
}

export interface FileExplorerPanelProps extends FileExplorerTreeProps {
  isOpen: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

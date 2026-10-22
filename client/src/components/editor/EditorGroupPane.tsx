import type { DragEvent, RefObject } from 'react';
import type { OnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import type {
  AwarenessState,
  ConnectionStatus,
  RoomEntry,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';
import { EditorTabs } from './EditorTabs';
import { EmptyEditorPane } from './EmptyEditorPane';
import { EditorCodePane } from './EditorCodePane';
import { languageForFileName, type LanguageMode } from './languageModes';

export interface EditorGroupPaneProps {
  group: 'primary' | 'secondary';
  entries: RoomEntry[];
  activeFileId: string;
  activeFile?: RoomEntry;
  activeFilePath: string;
  fileIds: string[];
  canSplitWorkspace: boolean;
  isSplitWorkspaceOpen: boolean;
  splitWidth: number;
  status: ConnectionStatus;
  isLocked: boolean;
  autocompleteEnabled: boolean;
  language: LanguageMode;
  peers: Map<string, AwarenessState>;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  monacoEditor?: monaco.editor.IStandaloneCodeEditor | null;
  onMount: OnMount;
  onOpenFile: (fileId: string, group?: 'primary' | 'secondary') => void;
  onCloseFileTab: (fileId: string) => void;
  onSplitWorkspace?: () => void;
  onCloseGroup?: () => void;
  onSetActiveGroup: (group: 'primary' | 'secondary') => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (
    event: DragEvent<HTMLDivElement>,
    group: 'primary' | 'secondary'
  ) => void;
  fileDiagnostics?: Record<string, 'error' | 'warning'>;
}

export function EditorGroupPane({
  group,
  entries,
  activeFileId,
  activeFile,
  activeFilePath,
  fileIds,
  canSplitWorkspace,
  isSplitWorkspaceOpen,
  splitWidth,
  status,
  isLocked,
  autocompleteEnabled,
  language,
  peers,
  providerRef,
  monacoEditor,
  onMount,
  onOpenFile,
  onCloseFileTab,
  onSplitWorkspace,
  onCloseGroup,
  onSetActiveGroup,
  onDragOver,
  onDrop,
  fileDiagnostics,
}: EditorGroupPaneProps) {
  const isPrimary = group === 'primary';
  return (
    <div
      className={`editor-pane${isPrimary ? '' : ' split-editor-pane'}`}
      style={getPaneStyle(group, isSplitWorkspaceOpen, splitWidth)}
      onFocusCapture={() => onSetActiveGroup(group)}
      onDragOver={onDragOver}
      onDrop={(event) => onDrop(event, group)}
    >
      <EditorGroupTabBar
        group={group}
        activeFileId={activeFileId}
        activeFile={activeFile}
        entries={entries}
        fileIds={fileIds}
        canSplitWorkspace={canSplitWorkspace}
        fileDiagnostics={fileDiagnostics}
        onOpenFile={onOpenFile}
        onCloseFileTab={onCloseFileTab}
        onSplitWorkspace={onSplitWorkspace}
        onCloseGroup={onCloseGroup}
      />
      <EditorGroupContent
        group={group}
        entries={entries}
        activeFileId={activeFileId}
        activeFile={activeFile}
        activeFilePath={activeFilePath}
        status={status}
        isLocked={isLocked}
        autocompleteEnabled={autocompleteEnabled}
        language={language}
        peers={peers}
        providerRef={providerRef}
        monacoEditor={monacoEditor}
        onMount={onMount}
        onOpenFile={onOpenFile}
      />
    </div>
  );
}

function getPaneStyle(
  group: 'primary' | 'secondary',
  isSplitWorkspaceOpen: boolean,
  splitWidth: number
) {
  if (!isSplitWorkspaceOpen) return undefined;
  const width = group === 'primary' ? 100 - splitWidth : splitWidth;
  return { flexBasis: `${width}%` };
}

function EditorGroupTabBar({
  group,
  activeFileId,
  activeFile,
  entries,
  fileIds,
  canSplitWorkspace,
  fileDiagnostics,
  onOpenFile,
  onCloseFileTab,
  onSplitWorkspace,
  onCloseGroup,
}: Pick<
  EditorGroupPaneProps,
  | 'group'
  | 'activeFileId'
  | 'activeFile'
  | 'entries'
  | 'fileIds'
  | 'canSplitWorkspace'
  | 'fileDiagnostics'
  | 'onOpenFile'
  | 'onCloseFileTab'
  | 'onSplitWorkspace'
  | 'onCloseGroup'
>) {
  const selectedFileId =
    group === 'primary' ? activeFileId : (activeFile?.id ?? '');
  return (
    <EditorTabs
      group={group}
      entries={entries}
      fileIds={fileIds}
      canSplitWorkspace={canSplitWorkspace}
      selectedFileId={selectedFileId}
      fileDiagnostics={fileDiagnostics}
      onSelectFile={(id) => onOpenFile(id, group)}
      onCloseFile={onCloseFileTab}
      onSplitWorkspace={onSplitWorkspace}
      onCloseGroup={onCloseGroup}
    />
  );
}

function EditorGroupContent({
  group,
  entries,
  activeFileId,
  activeFile,
  activeFilePath,
  status,
  isLocked,
  autocompleteEnabled,
  language,
  peers,
  providerRef,
  monacoEditor,
  onMount,
  onOpenFile,
}: Pick<
  EditorGroupPaneProps,
  | 'group'
  | 'entries'
  | 'activeFileId'
  | 'activeFile'
  | 'activeFilePath'
  | 'status'
  | 'isLocked'
  | 'autocompleteEnabled'
  | 'language'
  | 'peers'
  | 'providerRef'
  | 'monacoEditor'
  | 'onMount'
  | 'onOpenFile'
>) {
  if (!activeFile)
    return (
      <EmptyEditorPane
        entries={entries}
        group={group}
        onOpenFile={onOpenFile}
      />
    );

  const isPrimary = group === 'primary';
  return (
    <EditorCodePane
      fileId={isPrimary ? activeFileId : activeFile.id}
      filePath={activeFilePath}
      language={isPrimary ? language : languageForFileName(activeFilePath)}
      status={status}
      isLocked={isLocked}
      autocompleteEnabled={autocompleteEnabled}
      minimapEnabled={isPrimary}
      onMount={onMount}
      editor={isPrimary ? monacoEditor : undefined}
      peers={isPrimary ? peers : undefined}
      providerRef={isPrimary ? providerRef : undefined}
    />
  );
}

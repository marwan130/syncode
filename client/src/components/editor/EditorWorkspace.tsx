import { useRef } from 'react';
import type { DragEvent, FC, RefObject } from 'react';
import type { OnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { ResizeHandle } from './ResizeHandle';
import type { LanguageMode } from './languageModes';
import { EditorGroupPane } from './EditorGroupPane';
import type {
  AwarenessState,
  ConnectionStatus,
  RoomEntry,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';

export interface EditorWorkspaceProps {
  entries: RoomEntry[];
  activeFileId: string;
  activeFile?: RoomEntry;
  activeFilePath: string;
  openFileIds: string[];
  canSplitWorkspace: boolean;
  splitFileId: string | null;
  splitFile?: RoomEntry;
  splitFilePath: string;
  isSplitWorkspaceOpen: boolean;
  splitWidth: number;
  status: ConnectionStatus;
  isLocked: boolean;
  autocompleteEnabled: boolean;
  language: LanguageMode;
  peers: Map<string, AwarenessState>;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  monacoEditor: monaco.editor.IStandaloneCodeEditor | null;
  onMountPrimary: OnMount;
  onMountSecondary: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  onOpenFile: (fileId: string, group?: 'primary' | 'secondary') => void;
  onCloseFileTab: (fileId: string) => void;
  onSplitWorkspace: () => void;
  onCloseSplitGroup: () => void;
  onSplitWidthChange: (updater: (current: number) => number) => void;
  onSetActiveGroup: (group: 'primary' | 'secondary') => void;
  onDropFile: (fileId: string, group: 'primary' | 'secondary') => void;
  fileDiagnostics?: Record<string, 'error' | 'warning'>;
}

export const EditorWorkspace: FC<EditorWorkspaceProps> = ({
  entries,
  activeFileId,
  activeFile,
  activeFilePath,
  openFileIds,
  canSplitWorkspace,
  splitFileId,
  splitFile,
  splitFilePath,
  isSplitWorkspaceOpen,
  splitWidth,
  status,
  isLocked,
  autocompleteEnabled,
  language,
  peers,
  providerRef,
  monacoEditor,
  onMountPrimary,
  onMountSecondary,
  onOpenFile,
  onCloseFileTab,
  onSplitWorkspace,
  onCloseSplitGroup,
  onSplitWidthChange,
  onSetActiveGroup,
  onDropFile,
  fileDiagnostics,
}) => {
  const editorGroupsRef = useRef<HTMLDivElement>(null);
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('application/x-syncode-file-id')) {
      event.preventDefault();
    }
  };

  const handleDrop = (
    event: DragEvent<HTMLDivElement>,
    group: 'primary' | 'secondary'
  ) => {
    const fileId = event.dataTransfer.getData('application/x-syncode-file-id');
    if (
      !fileId ||
      !entries.some((entry) => entry.id === fileId && !entry.isFolder)
    )
      return;
    event.preventDefault();
    onDropFile(fileId, group);
  };

  return (
    <div className="editor-region">
      {isLocked && (
        <div className="editor-lock-notice" role="status" aria-live="polite">
          You can’t edit this room right now. Ask a room admin to restore your
          access.
        </div>
      )}
      <div className="editor-workspace" ref={editorGroupsRef}>
        <EditorGroupPane
          group="primary"
          entries={entries}
          activeFileId={activeFileId}
          activeFile={activeFile}
          activeFilePath={activeFilePath}
          fileIds={openFileIds}
          canSplitWorkspace={canSplitWorkspace}
          isSplitWorkspaceOpen={isSplitWorkspaceOpen}
          splitWidth={splitWidth}
          status={status}
          isLocked={isLocked}
          autocompleteEnabled={autocompleteEnabled}
          language={language}
          peers={peers}
          providerRef={providerRef}
          monacoEditor={monacoEditor}
          onMount={onMountPrimary}
          onOpenFile={onOpenFile}
          onCloseFileTab={onCloseFileTab}
          onSplitWorkspace={onSplitWorkspace}
          onSetActiveGroup={onSetActiveGroup}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          fileDiagnostics={fileDiagnostics}
        />

        {isSplitWorkspaceOpen && (
          <SplitEditorGroup
            editorGroupsRef={editorGroupsRef}
            canSplitWorkspace={canSplitWorkspace}
            entries={entries}
            splitFileId={splitFileId}
            splitFile={splitFile}
            splitFilePath={splitFilePath}
            splitWidth={splitWidth}
            status={status}
            isLocked={isLocked}
            autocompleteEnabled={autocompleteEnabled}
            language={language}
            peers={peers}
            providerRef={providerRef}
            onMountSecondary={onMountSecondary}
            onOpenFile={onOpenFile}
            onCloseFileTab={onCloseFileTab}
            onCloseSplitGroup={onCloseSplitGroup}
            onSplitWidthChange={onSplitWidthChange}
            onSetActiveGroup={onSetActiveGroup}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            fileDiagnostics={fileDiagnostics}
          />
        )}
      </div>
    </div>
  );
};

type SplitEditorGroupProps = Pick<
  EditorWorkspaceProps,
  | 'entries'
  | 'splitFileId'
  | 'splitFile'
  | 'splitFilePath'
  | 'splitWidth'
  | 'status'
  | 'isLocked'
  | 'autocompleteEnabled'
  | 'language'
  | 'peers'
  | 'providerRef'
  | 'onMountSecondary'
  | 'onOpenFile'
  | 'onCloseFileTab'
  | 'onCloseSplitGroup'
  | 'onSplitWidthChange'
  | 'onSetActiveGroup'
  | 'fileDiagnostics'
> & {
  canSplitWorkspace: boolean;
  editorGroupsRef: RefObject<HTMLDivElement | null>;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (
    event: DragEvent<HTMLDivElement>,
    group: 'primary' | 'secondary'
  ) => void;
};

function SplitEditorGroup({
  editorGroupsRef,
  canSplitWorkspace,
  entries,
  splitFileId,
  splitFile,
  splitFilePath,
  splitWidth,
  status,
  isLocked,
  autocompleteEnabled,
  language,
  peers,
  providerRef,
  onMountSecondary,
  onOpenFile,
  onCloseFileTab,
  onCloseSplitGroup,
  onSplitWidthChange,
  onSetActiveGroup,
  onDragOver,
  onDrop,
  fileDiagnostics,
}: SplitEditorGroupProps) {
  const handleResize = (delta: number) => {
    const width = editorGroupsRef.current?.getBoundingClientRect().width ?? 0;
    if (width <= 0) return;
    onSplitWidthChange((ratio) =>
      Math.max(25, Math.min(75, ratio + (delta / width) * 100))
    );
  };

  return (
    <>
      <ResizeHandle
        label="Resize editor groups"
        reverse
        onResize={handleResize}
      />
      <EditorGroupPane
        group="secondary"
        entries={entries}
        activeFileId={splitFileId ?? ''}
        activeFile={splitFile}
        activeFilePath={splitFilePath}
        fileIds={splitFileId ? [splitFileId] : []}
        canSplitWorkspace={canSplitWorkspace}
        isSplitWorkspaceOpen
        splitWidth={splitWidth}
        status={status}
        isLocked={isLocked}
        autocompleteEnabled={autocompleteEnabled}
        language={language}
        peers={peers}
        providerRef={providerRef}
        onMount={onMountSecondary}
        onOpenFile={onOpenFile}
        onCloseFileTab={onCloseFileTab}
        onCloseGroup={onCloseSplitGroup}
        onSetActiveGroup={onSetActiveGroup}
        onDragOver={onDragOver}
        onDrop={onDrop}
        fileDiagnostics={fileDiagnostics}
      />
    </>
  );
}

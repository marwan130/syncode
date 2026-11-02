import { lazy, Suspense, useCallback } from 'react';
import type { DragEvent, RefObject } from 'react';
import type { OnMount } from '@monaco-editor/react';
import type {
  AwarenessState,
  ConnectionStatus,
  RoomEntry,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';
import { getEntryPath } from './editorLayoutStorage';
import { EditorTabs } from './EditorTabs';
import { EditorWelcomePane } from './EditorWelcomePane';
import { SplitEditorPane } from './SplitEditorPane';
import type { EditorWelcomeActions } from './EditorWelcomePane';
import { languageForFileName } from './languageModes';
import { canSplitEditorGroup } from './editorGroups';
import type { EditorGroupState } from './editorGroups';
import type {
  GithubChangeReviewTab,
  GithubChangeStatus,
} from '../../github/changeTracker';
import type { EditorGroupActions } from './editorGroupTypes';

const EditorCodePane = lazy(() =>
  import('./EditorCodePane').then(({ EditorCodePane }) => ({
    default: EditorCodePane,
  }))
);
const GithubChangeDiffEditor = lazy(() =>
  import('./GithubChangeDiffEditor').then(({ GithubChangeDiffEditor }) => ({
    default: GithubChangeDiffEditor,
  }))
);

export interface EditorGroupPaneProps extends EditorGroupActions {
  group: EditorGroupState;
  entries: RoomEntry[];
  reviewTabs?: GithubChangeReviewTab[];
  sourceControlChanges?: GithubChangeStatus[];
  groupIndex: number;
  groupCount: number;
  isActive: boolean;
  canSplitWorkspace: boolean;
  status: ConnectionStatus;
  isLocked: boolean;
  autocompleteEnabled: boolean;
  peers: Map<string, AwarenessState>;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  onCloseGroup: (groupId: string) => void;
  onSetActiveGroup: (groupId: string) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, groupId: string) => void;
  fileDiagnostics?: Record<string, 'error' | 'warning'>;
  fileProblemCounts?: Record<string, number>;
  welcome?: EditorWelcomeActions;
}

export function EditorGroupPane({
  group,
  entries,
  reviewTabs = [],
  sourceControlChanges = [],
  groupIndex,
  groupCount,
  isActive,
  canSplitWorkspace,
  status,
  isLocked,
  autocompleteEnabled,
  peers,
  providerRef,
  onMountGroup,
  onDisposeGroup,
  onOpenFile,
  onOpenReviewTab,
  onCloseFileTab,
  onSplitWorkspace,
  onCloseGroup,
  onSetActiveGroup,
  onDragOver,
  onDrop,
  fileDiagnostics,
  fileProblemCounts,
  welcome,
}: EditorGroupPaneProps) {
  const activeFile = entries.find(
    (entry) => entry.id === group.activeFileId && !entry.isFolder
  );
  const activeReviewTab = reviewTabs.find(
    (tab) => tab.id === group.activeFileId
  );
  const activeFilePath = activeFile ? getEntryPath(activeFile, entries) : '';
  const onMount = useCallback<OnMount>(
    (editor, monacoApi) => onMountGroup(group.id, editor, monacoApi),
    [group.id, onMountGroup]
  );
  const onDispose = useCallback(
    () => onDisposeGroup(group.id),
    [group.id, onDisposeGroup]
  );

  return (
    <div
      className={`editor-pane${isActive ? ' is-active' : ''}`}
      style={{ flexBasis: `${group.width}%` }}
      onFocusCapture={() => onSetActiveGroup(group.id)}
      onDragOver={onDragOver}
      onDrop={(event) => onDrop(event, group.id)}
    >
      <EditorTabs
        group={`Editor group ${groupIndex + 1}`}
        entries={entries}
        reviewTabs={reviewTabs}
        sourceControlChanges={sourceControlChanges}
        fileIds={group.fileIds}
        selectedFileId={group.activeFileId}
        fileDiagnostics={fileDiagnostics}
        fileProblemCounts={fileProblemCounts}
        onSelectFile={(fileId) => {
          const reviewTab = reviewTabs.find((tab) => tab.id === fileId);
          if (reviewTab) onOpenReviewTab(reviewTab, group.id);
          else onOpenFile(fileId, group.id);
        }}
        onCloseFile={(fileId) => onCloseFileTab(fileId, group.id)}
        canSplitWorkspace={canSplitWorkspace && canSplitEditorGroup(group)}
        onSplitWorkspace={() => onSplitWorkspace(group.id)}
        canCloseGroup={groupCount > 1}
        onCloseGroup={() => onCloseGroup(group.id)}
      />
      {activeReviewTab ? (
        <Suspense fallback={<EditorLoadingState />}>
          <GithubChangeDiffEditor tab={activeReviewTab} />
        </Suspense>
      ) : activeFile ? (
        <Suspense fallback={<EditorLoadingState />}>
          <EditorCodePane
            fileId={activeFile.id}
            filePath={activeFilePath}
            language={languageForFileName(activeFilePath)}
            status={status}
            isLocked={isLocked}
            autocompleteEnabled={autocompleteEnabled}
            minimapEnabled={group.width >= 30}
            onMount={onMount}
            onDispose={onDispose}
            peers={peers}
            providerRef={providerRef}
          />
        </Suspense>
      ) : groupIndex === 0 || group.id === 'primary' ? (
        <EditorWelcomePane welcome={welcome} />
      ) : (
        <SplitEditorPane
          entries={entries}
          group={group.id}
          onOpenFile={(fileId) => onOpenFile(fileId, group.id)}
        />
      )}
    </div>
  );
}

function EditorLoadingState() {
  return (
    <div className="editor-loading-state" role="status" aria-busy="true">
      Loading editor…
    </div>
  );
}

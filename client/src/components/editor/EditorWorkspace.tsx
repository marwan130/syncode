import { Fragment, useRef } from 'react';
import type { DragEvent, FC, RefObject } from 'react';
import type {
  GithubChangeReviewTab,
  GithubChangeStatus,
} from '../../github/changeTracker';
import { ResizeHandle } from './ResizeHandle';
import { EditorGroupPane } from './EditorGroupPane';
import type { EditorGroupState } from './editorGroups';
import type { EditorWelcomeActions } from './EmptyEditorPane';
import type {
  AwarenessState,
  ConnectionStatus,
  RoomEntry,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';
import type { EditorGroupActions } from './editorGroupTypes';

export interface EditorWorkspaceProps extends Omit<
  EditorGroupActions,
  'onCloseGroup'
> {
  entries: RoomEntry[];
  reviewTabs?: GithubChangeReviewTab[];
  sourceControlChanges?: GithubChangeStatus[];
  editorGroups: EditorGroupState[];
  activeEditorGroupId: string;
  canSplitWorkspace: boolean;
  hasLivePreview: boolean;
  status: ConnectionStatus;
  isLocked: boolean;
  autocompleteEnabled: boolean;
  peers: Map<string, AwarenessState>;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  onCloseEditorGroup: (groupId: string) => void;
  onResizeEditorGroups: (
    leftGroupId: string,
    deltaPixels: number,
    totalWidth: number
  ) => void;
  onSetActiveGroup: (groupId: string) => void;
  onDropFile: (fileId: string, groupId: string) => void;
  fileDiagnostics?: Record<string, 'error' | 'warning'>;
  fileProblemCounts?: Record<string, number>;
  welcome?: EditorWelcomeActions;
}

export const EditorWorkspace: FC<EditorWorkspaceProps> = ({
  entries,
  reviewTabs = [],
  sourceControlChanges = [],
  editorGroups,
  activeEditorGroupId,
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
  onCloseEditorGroup,
  onResizeEditorGroups,
  onSetActiveGroup,
  onDropFile,
  fileDiagnostics,
  fileProblemCounts,
  welcome,
}) => {
  const editorGroupsRef = useRef<HTMLDivElement>(null);
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('application/x-syncode-file-id')) {
      event.preventDefault();
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, groupId: string) => {
    const fileId = event.dataTransfer.getData('application/x-syncode-file-id');
    if (
      !fileId ||
      !entries.some((entry) => entry.id === fileId && !entry.isFolder)
    ) {
      return;
    }
    event.preventDefault();
    onDropFile(fileId, groupId);
  };

  return (
    <div className={`editor-region${isLocked ? ' is-locked' : ''}`}>
      {isLocked && (
        <div className="editor-lock-notice" role="status" aria-live="polite">
          You can’t edit this room right now. Ask a room admin to restore your
          access.
        </div>
      )}
      <div className="editor-workspace" ref={editorGroupsRef}>
        {editorGroups.map((group, index) => {
          const previousGroup = editorGroups[index - 1];
          return (
            <Fragment key={group.id}>
              {previousGroup && (
                <ResizeHandle
                  label={`Resize ${previousGroup.id} and ${group.id}`}
                  onResize={(delta) => {
                    const totalWidth =
                      editorGroupsRef.current?.getBoundingClientRect().width ??
                      0;
                    onResizeEditorGroups(previousGroup.id, delta, totalWidth);
                  }}
                />
              )}
              <EditorGroupPane
                group={group}
                entries={entries}
                reviewTabs={reviewTabs}
                sourceControlChanges={sourceControlChanges}
                groupIndex={index}
                groupCount={editorGroups.length}
                isActive={activeEditorGroupId === group.id}
                canSplitWorkspace={canSplitWorkspace}
                status={status}
                isLocked={isLocked}
                autocompleteEnabled={autocompleteEnabled}
                peers={peers}
                providerRef={providerRef}
                onMountGroup={onMountGroup}
                onDisposeGroup={onDisposeGroup}
                onOpenFile={onOpenFile}
                onOpenReviewTab={onOpenReviewTab}
                onCloseFileTab={onCloseFileTab}
                onSplitWorkspace={onSplitWorkspace}
                onCloseGroup={onCloseEditorGroup}
                onSetActiveGroup={onSetActiveGroup}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                fileDiagnostics={fileDiagnostics}
                fileProblemCounts={fileProblemCounts}
                welcome={welcome}
              />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
};

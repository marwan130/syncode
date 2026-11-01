import type { ComponentProps, Dispatch, SetStateAction } from 'react';
import { useAppActivity } from '../shared/useAppActivity';
import { RoomHeader } from '../room/RoomHeader';
import { ChatPanelContainer } from './ChatPanelContainer';
import { EditorWorkspace } from './EditorWorkspace';
import { FileExplorerPanel } from './FileExplorerPanel';
import { PreviewPanel } from './PreviewPanel';
import { ShortcutGuideDialog } from './ShortcutGuideDialog';
import { TerminalPanel } from './TerminalPanel';
import { ActivityBar } from './ActivityBar';
import type { ActivityView } from './ActivityBar';
import { ActivityViewPanel } from './ActivityViewPanel';
import type { FileProblem } from '../../hooks/useFileDiagnostics';
import { Icon } from '@iconify/react';

export interface EditorRoomLayoutProps {
  roomHeader: ComponentProps<typeof RoomHeader>;
  connectionError: string | null;
  onSaveProject?: () => Promise<void>;
  fileExplorer: ComponentProps<typeof FileExplorerPanel>;
  chat: ComponentProps<typeof ChatPanelContainer>;
  workspace: ComponentProps<typeof EditorWorkspace>;
  preview: ComponentProps<typeof PreviewPanel>;
  terminal: ComponentProps<typeof TerminalPanel>;
  isShortcutGuideOpen: boolean;
  setShortcutGuideOpen: Dispatch<SetStateAction<boolean>>;
  activeSidebarView: ActivityView | null;
  onSelectSidebarView: (view: ActivityView) => void;
  onCloseSidebarView: () => void;
  activity: Omit<
    ComponentProps<typeof ActivityViewPanel>,
    'activeView' | 'width' | 'onWidthChange' | 'onClose'
  >;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  onToggleChat: () => void;
  problems: FileProblem[];
  onOpenProblems: () => void;
}

export function EditorRoomLayout({
  roomHeader,
  connectionError,
  onSaveProject,
  fileExplorer,
  chat,
  workspace,
  preview,
  terminal,
  isShortcutGuideOpen,
  setShortcutGuideOpen,
  activeSidebarView,
  onSelectSidebarView,
  onCloseSidebarView,
  activity,
  sidebarWidth,
  onSidebarWidthChange,
  onToggleChat,
  problems,
  onOpenProblems,
}: EditorRoomLayoutProps) {
  return (
    <div className="room-workspace">
      <RoomHeader
        {...roomHeader}
        notice={
          <RoomConnectionNotices
            error={connectionError}
            status={workspace.status}
            onLeaveRoom={roomHeader.profile.onLeaveRoom}
            onSaveProject={onSaveProject}
          />
        }
      />

      <div className="room-main">
        <ActivityBar
          activeView={activeSidebarView}
          onSelect={onSelectSidebarView}
          isChatOpen={chat.isOpen}
          onToggleChat={onToggleChat}
        />
        <MobileWorkbenchBackdrop
          isOpen={Boolean(activeSidebarView || chat.isOpen)}
          onClose={() => {
            onCloseSidebarView();
            chat.onClose();
          }}
        />
        {activeSidebarView === 'explorer' ? (
          <FileExplorerPanel
            {...fileExplorer}
            githubChanges={activity.github?.changes ?? []}
            isOpen
          />
        ) : (
          <ActivityViewPanel
            {...activity}
            activeView={activeSidebarView}
            width={sidebarWidth}
            onWidthChange={onSidebarWidthChange}
            onClose={onCloseSidebarView}
          />
        )}
        <section
          className="workbench-main-column"
          aria-label="Editor and terminal area"
        >
          <div
            className={`room-editor${workspace.hasLivePreview ? ' has-live-preview' : ''}`}
          >
            <EditorWorkspace {...workspace} />
            <PreviewPanel {...preview} />
          </div>
          <TerminalPanel {...terminal} />
        </section>
        <ChatPanelContainer {...chat} />
      </div>

      <WorkspaceStatusBar
        problems={problems}
        onOpenProblems={onOpenProblems}
        onOpenShortcuts={() => setShortcutGuideOpen(true)}
      />

      <ShortcutGuideDialog
        isOpen={isShortcutGuideOpen}
        onClose={() => setShortcutGuideOpen(false)}
      />
    </div>
  );
}

function RoomConnectionNotices({
  error,
  status,
  onLeaveRoom,
  onSaveProject,
}: {
  error: string | null;
  status: string;
  onLeaveRoom?: () => Promise<void>;
  onSaveProject?: () => Promise<void>;
}) {
  const { currentActivity } = useAppActivity();

  if (error) {
    return (
      <div className="room-header-notice is-error" role="alert">
        <span>{error}</span>
        {onSaveProject && (
          <button
            className="room-header-notice-cancel"
            type="button"
            onClick={() => void onSaveProject()}
          >
            Download Copy
          </button>
        )}
      </div>
    );
  }

  if (status === 'connecting') {
    return (
      <div className="room-header-notice is-notice" role="status">
        <span className="room-header-notice-dot" aria-hidden="true" />
        <span>Connecting to room…</span>
      </div>
    );
  }

  if (status === 'offline') {
    return (
      <div className="room-header-notice is-warning" role="status">
        <span className="room-header-notice-dot" aria-hidden="true" />
        <span>
          You're offline. Edits are saved locally and will sync when you
          reconnect.
        </span>
      </div>
    );
  }

  if (status === 'reconnecting') {
    return (
      <div className="room-header-notice is-notice" role="status">
        <span className="room-header-notice-dot" aria-hidden="true" />
        <span>Reconnecting… Your edits are preserved.</span>
      </div>
    );
  }

  if (status === 'awaiting-approval') {
    return (
      <div className="room-header-notice is-notice" role="status">
        <span className="room-header-notice-dot" aria-hidden="true" />
        <span>Waiting for a room admin to approve your join request.</span>
        {onLeaveRoom && (
          <button
            className="room-header-notice-cancel"
            type="button"
            onClick={() => void onLeaveRoom()}
          >
            Cancel
          </button>
        )}
      </div>
    );
  }

  if (currentActivity && currentActivity !== 'Saving changes…') {
    return (
      <div className="room-header-notice is-notice" role="status">
        <span className="room-header-notice-dot" aria-hidden="true" />
        <span>{currentActivity}</span>
      </div>
    );
  }

  return null;
}

function MobileWorkbenchBackdrop({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;
  return (
    <button
      className="mobile-workbench-backdrop"
      type="button"
      aria-label="Close open panels"
      onClick={onClose}
    />
  );
}

function WorkspaceStatusBar({
  problems,
  onOpenProblems,
  onOpenShortcuts,
}: {
  problems: FileProblem[];
  onOpenProblems: () => void;
  onOpenShortcuts: () => void;
}) {
  const problemCounts = problems.reduce(
    (counts, problem) => {
      if (problem.severity === 'error') counts.errors++;
      if (problem.severity === 'warning') counts.warnings++;
      return counts;
    },
    { errors: 0, warnings: 0 }
  );

  return (
    <footer className="workspace-footer">
      <div className="workspace-status-actions">
        <button
          type="button"
          aria-label={`Show Problems. ${problemCounts.errors} errors and ${problemCounts.warnings} warnings`}
          title="Show Problems"
          onClick={onOpenProblems}
        >
          <Icon icon="codicon:error" aria-hidden="true" />
          <span>{problemCounts.errors}</span>
          <Icon icon="codicon:warning" aria-hidden="true" />
          <span>{problemCounts.warnings}</span>
        </button>
      </div>
      <div className="workspace-status-actions workspace-status-preferences">
        <button
          className="keyboard-shortcut-hint"
          type="button"
          aria-label="Open keyboard shortcuts"
          title="Keyboard shortcuts"
          onClick={onOpenShortcuts}
        >
          Keyboard Shortcuts <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd>
        </button>
      </div>
    </footer>
  );
}

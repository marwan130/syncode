import type { ComponentProps, Dispatch, SetStateAction } from 'react';
import { RoomHeader } from '../room/RoomHeader';
import { ChatPanelContainer } from './ChatPanelContainer';
import { EditorWorkspace } from './EditorWorkspace';
import { FileExplorerPanel } from './FileExplorerPanel';
import { PreviewPanel } from './PreviewPanel';
import { ShortcutGuideDialog } from './ShortcutGuideDialog';
import { TerminalPanel } from './TerminalPanel';
import { isPreviewLanguage } from './languageModes';
import { ActivityBar } from './ActivityBar';
import type { ActivityView } from './ActivityBar';
import { ActivityViewPanel } from './ActivityViewPanel';
import { useGithubStaging } from '../../github/useGithubStaging';

export interface EditorRoomLayoutProps {
  roomHeader: ComponentProps<typeof RoomHeader>;
  connectionError: string | null;
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
    | 'githubStaging'
  >;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  onToggleChat: () => void;
}

export function EditorRoomLayout({
  roomHeader,
  connectionError,
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
}: EditorRoomLayoutProps) {
  const githubStaging = useGithubStaging(activity.github?.changes ?? []);

  return (
    <div className="room-workspace">
      <RoomHeader {...roomHeader} />

      {connectionError && (
        <div className="room-connection-error" role="alert">
          {connectionError}
        </div>
      )}
      {workspace.status === 'awaiting-approval' && (
        <div className="room-connection-notice" role="status">
          Waiting for a room admin to approve your join request.
        </div>
      )}
      {workspace.status === 'join-rejected' && (
        <div className="room-connection-error" role="alert">
          A room admin declined your request to join.
        </div>
      )}

      <div className="room-main">
        <ActivityBar
          activeView={activeSidebarView}
          onSelect={onSelectSidebarView}
          isChatOpen={chat.isOpen}
          onToggleChat={onToggleChat}
        />
        {activeSidebarView === 'explorer' ? (
          <FileExplorerPanel
            {...fileExplorer}
            githubChanges={activity.github?.changes ?? []}
            stagedPaths={githubStaging.stagedPaths}
            isOpen
          />
        ) : (
          <ActivityViewPanel
            {...activity}
            githubStaging={githubStaging}
            activeView={activeSidebarView}
            width={sidebarWidth}
            onWidthChange={onSidebarWidthChange}
            onClose={onCloseSidebarView}
          />
        )}
        <ChatPanelContainer {...chat} />

        <section
          className="workbench-main-column"
          aria-label="Editor and terminal area"
        >
          <div
            className={`room-editor${isPreviewLanguage(workspace.language) ? ' has-live-preview' : ''}`}
          >
            <EditorWorkspace {...workspace} />
            <PreviewPanel {...preview} />
          </div>
          <TerminalPanel {...terminal} />
        </section>
      </div>

      <footer className="workspace-footer">
        <button
          className="keyboard-shortcut-hint"
          type="button"
          onClick={() => setShortcutGuideOpen(true)}
        >
          Keyboard shortcuts <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd>
        </button>
      </footer>

      <ShortcutGuideDialog
        isOpen={isShortcutGuideOpen}
        onClose={() => setShortcutGuideOpen(false)}
      />
    </div>
  );
}

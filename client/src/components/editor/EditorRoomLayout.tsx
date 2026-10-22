import type { ComponentProps, Dispatch, SetStateAction } from 'react';
import { RoomHeader } from '../room/RoomHeader';
import { ChatPanelContainer } from './ChatPanelContainer';
import { EditorWorkspace } from './EditorWorkspace';
import { FileExplorerPanel } from './FileExplorerPanel';
import { PreviewPanel } from './PreviewPanel';
import { ShortcutGuideDialog } from './ShortcutGuideDialog';
import { TerminalPanel } from './TerminalPanel';
import { isPreviewLanguage } from './languageModes';

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
}: EditorRoomLayoutProps) {
  return (
    <div className="room-workspace">
      <RoomHeader {...roomHeader} />

      {connectionError && (
        <div className="room-connection-error" role="alert">
          {connectionError}
        </div>
      )}

      <div className="room-main">
        <FileExplorerPanel {...fileExplorer} />
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

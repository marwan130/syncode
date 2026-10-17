import { useRef, useState } from 'react';
import type * as monaco from 'monaco-editor';
import type {
  ConnectionStatus,
  AwarenessState,
} from '../../providers/SignalRCrdtProvider';
import { ParticipantList } from './ParticipantList';
import { ShareLinkButton } from './ShareLinkButton';
import { JoinRoomModal } from './JoinRoomModal';
import { SearchReplace } from '../editor/SearchReplace';
import { ThemePicker } from '../editor/ThemePicker';
import type { Monaco } from '@monaco-editor/react';

interface RoomHeaderProps {
  roomId: string;
  participantId: string;
  status: ConnectionStatus;
  localName: string;
  localColor: string;
  onJoinProfile: (info: { displayName: string; color: string }) => void;
  onColorChange: (color: string) => void;
  peers: Map<string, AwarenessState>;
  isAdmin: boolean;
  onToggleParticipantLock: (connectionId: string) => Promise<void>;
  onSetParticipantAdmin: (
    connectionId: string,
    isAdmin: boolean
  ) => Promise<void>;
  editor: monaco.editor.IStandaloneCodeEditor | null;
  monaco: Monaco | null;
  autocompleteEnabled: boolean;
  onAutocompleteChange: (enabled: boolean) => void;
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  isChatOpen: boolean;
  onToggleChat: () => void;
  showPreviewButton: boolean;
  onShowPreview: () => void;
  canRunCode: boolean;
  runDisabledReason?: string;
  isRunningCode: boolean;
  onRunCode: () => void;
  onOpenTerminal: () => void;
}

export function RoomHeader({
  roomId,
  participantId,
  status,
  localName,
  localColor,
  onJoinProfile,
  onColorChange,
  peers,
  isAdmin,
  onToggleParticipantLock,
  onSetParticipantAdmin,
  editor,
  monaco,
  autocompleteEnabled,
  onAutocompleteChange,
  explorerOpen,
  onToggleExplorer,
  isChatOpen,
  onToggleChat,
  showPreviewButton,
  onShowPreview,
  canRunCode,
  runDisabledReason,
  isRunningCode,
  onRunCode,
  onOpenTerminal,
}: RoomHeaderProps) {
  const [isJoinModalOpen, setJoinModalOpen] = useState(false);
  const joinAnchorRef = useRef<HTMLDivElement>(null);

  return (
    <header
      className="room-header"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        height: 40,
        background: 'var(--app-bg)',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      <div className="room-header-left">
        <button
          className="syncode-brand-toggle"
          type="button"
          title={explorerOpen ? 'Hide file explorer' : 'Show file explorer'}
          aria-label={
            explorerOpen ? 'Hide file explorer' : 'Show file explorer'
          }
          aria-expanded={explorerOpen}
          aria-keyshortcuts="Control+Alt+E"
          onClick={onToggleExplorer}
        >
          syncode
        </button>
        <button
          className={`chat-toggle${isChatOpen ? ' is-active' : ''}`}
          type="button"
          aria-pressed={isChatOpen}
          aria-keyshortcuts="Control+Alt+C"
          onClick={onToggleChat}
        >
          Chat
        </button>
      </div>

      <div className="room-header-right">
        <button
          className={`chat-toggle${autocompleteEnabled ? ' is-active' : ''}`}
          type="button"
          role="switch"
          aria-checked={autocompleteEnabled}
          aria-label="Automatic code suggestions"
          title={`Automatic code suggestions: ${autocompleteEnabled ? 'On' : 'Off'}`}
          onClick={() => onAutocompleteChange(!autocompleteEnabled)}
        >
          Suggestions {autocompleteEnabled ? 'On' : 'Off'}
        </button>

        <ThemePicker monaco={monaco} />

        <SearchReplace editor={editor} />

        <button
          className="execution-run-button"
          type="button"
          onClick={onRunCode}
          disabled={!canRunCode || isRunningCode}
          aria-keyshortcuts="Control+Alt+R"
          title={
            isRunningCode
              ? 'Execution in progress…'
              : canRunCode
                ? 'Compile and run the active file (Ctrl+Alt+R)'
                : runDisabledReason || 'Cannot run code'
          }
        >
          {isRunningCode ? (
            'Running…'
          ) : (
            <>
              <svg className="run-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 2.8v10.4L13 8z" fill="currentColor" />
              </svg>
              <span className="visually-hidden">Run</span>
            </>
          )}
        </button>

        <button
          className="execution-run-button"
          type="button"
          onClick={onOpenTerminal}
          disabled={status !== 'connected'}
          title="Open a Bash terminal (Ctrl+Alt+T)"
          aria-keyshortcuts="Control+Alt+T"
        >
          Terminal
        </button>

        {showPreviewButton && (
          <button
            className="preview-view-button"
            type="button"
            onClick={onShowPreview}
            aria-keyshortcuts="Control+Alt+P"
          >
            View
          </button>
        )}

        <div className="room-join-anchor" ref={joinAnchorRef}>
          <button
            className="room-join-toggle"
            type="button"
            onClick={() => setJoinModalOpen((open) => !open)}
            title="Join another room with a link"
            aria-expanded={isJoinModalOpen}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            <span>Join</span>
          </button>
          <JoinRoomModal
            isOpen={isJoinModalOpen}
            currentRoomId={roomId}
            currentName={localName}
            currentColor={localColor}
            containerRef={joinAnchorRef}
            onClose={() => setJoinModalOpen(false)}
          />
        </div>

        <ShareLinkButton />

        <ParticipantList
          roomId={roomId}
          participantId={participantId}
          localName={localName}
          localColor={localColor}
          peers={peers}
          isAdmin={isAdmin}
          onToggleLock={onToggleParticipantLock}
          onSetAdmin={onSetParticipantAdmin}
          onJoinProfile={onJoinProfile}
          onColorChange={onColorChange}
        />
      </div>
    </header>
  );
}

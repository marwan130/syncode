import { useRef, useState } from 'react';
import type * as monaco from 'monaco-editor';
import type {
  ConnectionStatus,
  AwarenessState,
} from '../../providers/SignalRCrdtProvider';
import { ParticipantList } from './ParticipantList';
import { ShareLinkButton } from './ShareLinkButton';
import { JoinRoomModal } from './JoinRoomModal';
import { RoomHeaderToolbar } from './RoomHeaderToolbar';
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
        <RoomHeaderToolbar
          status={status}
          editor={editor}
          monaco={monaco}
          autocompleteEnabled={autocompleteEnabled}
          onAutocompleteChange={onAutocompleteChange}
          showPreviewButton={showPreviewButton}
          onShowPreview={onShowPreview}
          canRunCode={canRunCode}
          runDisabledReason={runDisabledReason}
          isRunningCode={isRunningCode}
          onRunCode={onRunCode}
          onOpenTerminal={onOpenTerminal}
        />

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

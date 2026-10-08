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
  status: ConnectionStatus;
  localName: string;
  localColor: string;
  onJoinProfile: (info: { displayName: string; color: string }) => void;
  onColorChange: (color: string) => void;
  peers: Map<string, AwarenessState>;
  editor: monaco.editor.IStandaloneCodeEditor | null;
  monaco: Monaco | null;
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  isChatOpen: boolean;
  onToggleChat: () => void;
  showPreviewButton: boolean;
  onShowPreview: () => void;
}

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  connected: '#4ade80',
  connecting: '#facc15',
  reconnecting: '#f97316',
  disconnected: '#6b7280',
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  disconnected: 'Offline',
};

function StatusDot({ status }: { status: ConnectionStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
        }}
      />
      <span
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {STATUS_LABELS[status]}
      </span>
    </div>
  );
}

export function RoomHeader({
  roomId,
  status,
  localName,
  localColor,
  onJoinProfile,
  onColorChange,
  peers,
  editor,
  monaco,
  explorerOpen,
  onToggleExplorer,
  isChatOpen,
  onToggleChat,
  showPreviewButton,
  onShowPreview,
}: RoomHeaderProps) {
  const [isJoinModalOpen, setJoinModalOpen] = useState(false);
  const joinAnchorRef = useRef<HTMLDivElement>(null);

  return (
    <>
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
          borderBottom: '1px solid var(--border)',
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
            onClick={onToggleExplorer}
          >
            syncode
          </button>
          <button
            className={`chat-toggle${isChatOpen ? ' is-active' : ''}`}
            type="button"
            aria-pressed={isChatOpen}
            onClick={onToggleChat}
          >
            Chat
          </button>
        </div>

        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        >
          <StatusDot status={status} />
        </div>

        <div className="room-header-right">
          <ThemePicker monaco={monaco} />

          <SearchReplace editor={editor} />

          {showPreviewButton && (
            <button
              className="preview-view-button"
              type="button"
              onClick={onShowPreview}
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
            localName={localName}
            localColor={localColor}
            peers={peers}
            onJoinProfile={onJoinProfile}
            onColorChange={onColorChange}
          />
        </div>
      </header>

    </>
  );
}

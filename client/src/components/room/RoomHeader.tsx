import { useState } from 'react';
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
  peers: Map<string, AwarenessState>;
  onEditProfile: () => void;
  editor: monaco.editor.IStandaloneCodeEditor | null;
  monaco: Monaco | null;
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  isChatOpen: boolean;
  onToggleChat: () => void;
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
          boxShadow: `0 0 0 2px ${color}33`,
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
  peers,
  onEditProfile,
  editor,
  monaco,
  explorerOpen,
  onToggleExplorer,
  isChatOpen,
  onToggleChat,
}: RoomHeaderProps) {
  const [isJoinModalOpen, setJoinModalOpen] = useState(false);

  return (
    <>
      <header
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ThemePicker monaco={monaco} />

          <SearchReplace editor={editor} />

          <button
            className={`chat-toggle${isChatOpen ? ' is-active' : ''}`}
            type="button"
            aria-pressed={isChatOpen}
            onClick={onToggleChat}
          >
            Chat
          </button>

          <button
            onClick={() => setJoinModalOpen(true)}
            title="Join another room with a link"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 9px',
              fontSize: 12,
              fontWeight: 500,
              fontFamily: 'system-ui, sans-serif',
              color: 'var(--text-muted)',
              background: 'var(--control-bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              cursor: 'pointer',
              outline: 'none',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-h)';
              e.currentTarget.style.background = 'var(--surface-bg)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)';
              e.currentTarget.style.background = 'var(--control-bg)';
            }}
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

          <ShareLinkButton />

          <ParticipantList
            localName={localName}
            localColor={localColor}
            peers={peers}
            onEditProfile={onEditProfile}
          />
        </div>
      </header>

      <JoinRoomModal
        isOpen={isJoinModalOpen}
        currentRoomId={roomId}
        onClose={() => setJoinModalOpen(false)}
      />
    </>
  );
}

import type {
  ConnectionStatus,
  AwarenessState,
} from '../../providers/SignalRCrdtProvider';
import { ParticipantList } from './ParticipantList';

interface RoomHeaderProps {
  roomId: string;
  status: ConnectionStatus;
  localName: string;
  localColor: string;
  peers: Map<string, AwarenessState>;
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
          color: '#6b7280',
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
}: RoomHeaderProps) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        height: 40,
        background: '#1a1a1a',
        borderBottom: '1px solid #2a2a2a',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {/* left: app name + room id */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            fontFamily: 'system-ui, sans-serif',
            color: '#c084fc',
            letterSpacing: '-0.3px',
          }}
        >
          syncode
        </span>
        <span
          style={{
            fontSize: 12,
            color: '#4b5563',
            fontFamily: 'ui-monospace, Consolas, monospace',
          }}
        >
          /{roomId}
        </span>
      </div>

      {/* center: connection status */}
      <StatusDot status={status} />

      {/* right: participant avatars */}
      <ParticipantList
        localName={localName}
        localColor={localColor}
        peers={peers}
      />
    </header>
  );
}

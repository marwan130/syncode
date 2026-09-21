import type { AwarenessState } from '../../providers/SignalRCrdtProvider';

interface ParticipantListProps {
  localName: string;
  localColor: string;
  peers: Map<string, AwarenessState>;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function Avatar({
  name,
  color,
  title,
}: {
  name: string;
  color: string;
  title?: string;
}) {
  return (
    <div
      title={title ?? name}
      style={{
        width: 26,
        height: 26,
        borderRadius: '50%',
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: 10,
        fontWeight: 700,
        fontFamily: 'system-ui, sans-serif',
        flexShrink: 0,
        border: '2px solid rgba(255,255,255,0.12)',
        cursor: 'default',
        userSelect: 'none',
        letterSpacing: '0.5px',
      }}
    >
      {getInitials(name)}
    </div>
  );
}

// renders a horizontal row of colored avatar circles, one per connected peer
export function ParticipantList({
  localName,
  localColor,
  peers,
}: ParticipantListProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {/* local user always first */}
      <Avatar
        name={localName}
        color={localColor}
        title={`${localName} (you)`}
      />
      {Array.from(peers.entries()).map(([peerId, peer]) => (
        <Avatar key={peerId} name={peer.name} color={peer.color} />
      ))}
    </div>
  );
}

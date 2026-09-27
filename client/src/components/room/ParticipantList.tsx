import type { AwarenessState } from '../../providers/SignalRCrdtProvider';

interface ParticipantListProps {
  localName: string;
  localColor: string;
  peers: Map<string, AwarenessState>;
  onEditProfile: () => void;
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
  cursor = 'default',
}: {
  name: string;
  color: string;
  title?: string;
  cursor?: 'default' | 'pointer';
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
        cursor,
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
  onEditProfile,
}: ParticipantListProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {/* local user always first */}
      <button
        type="button"
        onClick={onEditProfile}
        title="Edit your display name and avatar color"
        aria-label="Edit your display name and avatar color"
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.12)';
          e.currentTarget.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.55)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = 'none';
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          border: 0,
          borderRadius: '50%',
          background: 'transparent',
          cursor: 'pointer',
          transition: 'transform 0.12s ease, box-shadow 0.12s ease',
        }}
      >
        <Avatar
          name={localName}
          color={localColor}
          title={`${localName} (you)`}
          cursor="pointer"
        />
      </button>
      {Array.from(peers.entries()).map(([peerId, peer]) => (
        <Avatar key={peerId} name={peer.name} color={peer.color} />
      ))}
    </div>
  );
}

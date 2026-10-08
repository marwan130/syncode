export function getAvatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function Avatar({
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
      {getAvatarInitials(name)}
    </div>
  );
}

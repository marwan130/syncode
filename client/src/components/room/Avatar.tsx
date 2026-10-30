import { useState } from 'react';

function getAvatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function Avatar({
  name,
  color,
  avatarUrl,
  title,
  cursor = 'default',
}: {
  name: string;
  color: string;
  avatarUrl?: string;
  title?: string;
  cursor?: 'default' | 'pointer';
}) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const showAvatarImage = Boolean(avatarUrl && failedAvatarUrl !== avatarUrl);

  return (
    <div
      title={title}
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
      {showAvatarImage ? (
        <img
          src={avatarUrl}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            objectFit: 'cover',
          }}
          onError={() => setFailedAvatarUrl(avatarUrl ?? null)}
        />
      ) : (
        getAvatarInitials(name)
      )}
    </div>
  );
}

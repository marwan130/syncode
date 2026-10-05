import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface JoinRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRoomId?: string;
}

export function JoinRoomModal({
  isOpen,
  onClose,
  currentRoomId,
}: JoinRoomModalProps) {
  const [inputVal, setInputVal] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputVal.trim();
    if (!trimmed) {
      setError('Please enter a room link');
      return;
    }

    let inviteUrl: URL;
    try {
      inviteUrl = new URL(
        trimmed.startsWith('/') || trimmed.startsWith('http')
          ? trimmed
          : `/room/${trimmed}`,
        window.location.origin
      );
    } catch {
      setError('Invalid room link');
      return;
    }

    const pathMatch = inviteUrl.pathname.match(/\/room\/([a-zA-Z0-9_-]+)\/?$/);
    const extractedId = pathMatch?.[1] ?? '';
    const accessKey =
      new URLSearchParams(inviteUrl.hash.slice(1)).get('key') ?? '';

    if (!extractedId || !/^[0-9a-f]{64}$/i.test(accessKey)) {
      setError('Use a complete room invite link with its access key');
      return;
    }

    if (currentRoomId && extractedId === currentRoomId) {
      setError('You are already in this room');
      return;
    }

    onClose();
    navigate(`/room/${extractedId}#key=${accessKey}`);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--app-bg)',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--surface-bg)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 28,
          boxShadow:
            '0 20px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            lineHeight: 1,
            color: 'var(--text-h)',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          Join Room with Link
        </h3>

        <form
          onSubmit={handleJoin}
          style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <div>
            <input
              type="text"
              autoFocus
              placeholder="Paste a room invite link"
              value={inputVal}
              onChange={(e) => {
                setInputVal(e.target.value);
                if (error) setError('');
              }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                fontSize: 14,
                fontFamily: 'ui-monospace, Consolas, monospace',
                background: 'var(--control-bg)',
                color: 'var(--text-h)',
                border: error
                  ? '1px solid var(--danger)'
                  : '1px solid var(--border)',
                borderRadius: 6,
                outline: 'none',
                transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
              }}
              onFocus={(e) => {
                if (!error) {
                  e.currentTarget.style.borderColor = 'var(--accent)';
                  e.currentTarget.style.boxShadow =
                    '0 0 0 3px rgba(56, 189, 248, 0.25)';
                }
              }}
              onBlur={(e) => {
                if (!error) {
                  e.currentTarget.style.borderColor = '#383842';
                  e.currentTarget.style.boxShadow = 'none';
                }
              }}
            />
            {error && (
              <span
                style={{
                  display: 'block',
                  fontSize: 12,
                  color: 'var(--danger)',
                  marginTop: 4,
                  fontFamily: 'system-ui, sans-serif',
                }}
              >
                {error}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: '10px 16px',
                fontSize: 14,
                fontFamily: 'system-ui, sans-serif',
                color: 'var(--text-muted)',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: 'pointer',
                boxShadow: 'none',
                outline: 'none',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                flex: 1,
                padding: '10px 16px',
                fontSize: 14,
                fontWeight: 600,
                fontFamily: 'system-ui, sans-serif',
                background: 'var(--button-bg)',
                color: 'var(--button-fg)',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                boxShadow: '0 2px 10px rgba(14, 165, 233, 0.4)',
                transition: 'opacity 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '0.92';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
            >
              Join Room
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

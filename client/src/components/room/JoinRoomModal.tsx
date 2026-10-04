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
          maxWidth: 380,
          background: 'var(--surface-bg)',
          border: '1px solid #2e2e34',
          borderRadius: 10,
          padding: 22,
          boxShadow: '0 20px 30px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3
            style={{
              margin: '0 0 6px',
              fontSize: 16,
              fontWeight: 600,
              color: '#f3f4f6',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            Join Room with Link
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: '#9ca3af',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            Paste the complete invite link to join.
          </p>
        </div>

        <form
          onSubmit={handleJoin}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div>
            <input
              type="text"
              autoFocus
              placeholder="Paste a complete room invite link"
              value={inputVal}
              onChange={(e) => {
                setInputVal(e.target.value);
                if (error) setError('');
              }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '9px 12px',
                fontSize: 13,
                fontFamily: 'ui-monospace, Consolas, monospace',
                background: 'var(--control-bg)',
                color: '#f3f4f6',
                border: error ? '1px solid #ef4444' : '1px solid #383842',
                borderRadius: 6,
                outline: 'none',
              }}
            />
            {error && (
              <span
                style={{
                  display: 'block',
                  fontSize: 12,
                  color: '#ef4444',
                  marginTop: 4,
                  fontFamily: 'system-ui, sans-serif',
                }}
              >
                {error}
              </span>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              marginTop: 4,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                fontFamily: 'system-ui, sans-serif',
                background: 'transparent',
                color: '#9ca3af',
                border: '1px solid #383842',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'system-ui, sans-serif',
                background: 'linear-gradient(135deg, #0284c7 0%, #0ea5e9 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(14, 165, 233, 0.35)',
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

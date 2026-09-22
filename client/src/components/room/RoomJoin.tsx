import { useState } from 'react';
import {
  CURSOR_COLORS,
  setStoredDisplayName,
  setStoredColor,
  getStoredColor,
} from '../../utils/userStorage';

interface RoomJoinProps {
  roomId: string;
  onJoin: (info: { displayName: string; color: string }) => void;
  defaultName?: string;
}

export function RoomJoin({ roomId, onJoin, defaultName = '' }: RoomJoinProps) {
  const [name, setName] = useState(defaultName);
  const [selectedColor, setSelectedColor] = useState<string>(() =>
    getStoredColor()
  );
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter a display name to continue');
      return;
    }

    setStoredDisplayName(trimmed);
    setStoredColor(selectedColor);
    onJoin({ displayName: trimmed, color: selectedColor });
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
        background: 'rgba(10, 10, 10, 0.85)',
        backdropFilter: 'blur(8px)',
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#161618',
          border: '1px solid #2e2e34',
          borderRadius: 12,
          padding: 28,
          boxShadow:
            '0 20px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              fontFamily: 'system-ui, sans-serif',
              background: 'linear-gradient(135deg, #a5f3fc 0%, #38bdf8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '-0.5px',
              marginBottom: 6,
            }}
          >
            syncode
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: '#9ca3af',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            Enter your name to join room{' '}
            <code
              style={{
                fontFamily: 'ui-monospace, Consolas, monospace',
                color: '#e5e7eb',
                background: '#26262a',
                padding: '2px 6px',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {roomId}
            </code>
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
        >
          <div>
            <label
              htmlFor="display-name-input"
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: '#d1d5db',
                fontFamily: 'system-ui, sans-serif',
                marginBottom: 6,
              }}
            >
              Display Name
            </label>
            <input
              id="display-name-input"
              type="text"
              autoFocus
              maxLength={24}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError('');
              }}
              placeholder="e.g. John"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                fontSize: 14,
                fontFamily: 'system-ui, sans-serif',
                background: '#202024',
                color: '#f3f4f6',
                border: error ? '1px solid #ef4444' : '1px solid #383842',
                borderRadius: 6,
                outline: 'none',
                transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
              }}
              onFocus={(e) => {
                if (!error) {
                  e.currentTarget.style.borderColor = '#38bdf8';
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
                  color: '#ef4444',
                  marginTop: 4,
                  fontFamily: 'system-ui, sans-serif',
                }}
              >
                {error}
              </span>
            )}
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 500,
                color: '#9ca3af',
                fontFamily: 'system-ui, sans-serif',
                marginBottom: 8,
              }}
            >
              Choose cursor color
            </label>
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              {CURSOR_COLORS.map((color) => {
                const isSelected = selectedColor === color;
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setSelectedColor(color)}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: color,
                      border: isSelected
                        ? '2px solid #ffffff'
                        : '2px solid transparent',
                      outline: isSelected ? `2px solid ${color}` : 'none',
                      cursor: 'pointer',
                      padding: 0,
                      transition: 'transform 0.1s ease',
                      transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                    }}
                  />
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            style={{
              marginTop: 6,
              padding: '10px 16px',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: 'system-ui, sans-serif',
              color: '#ffffff',
              background: 'linear-gradient(135deg, #0284c7 0%, #0ea5e9 100%)',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(14, 165, 233, 0.4)',
              transition: 'opacity 0.15s ease, transform 0.1s ease',
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
        </form>
      </div>
    </div>
  );
}

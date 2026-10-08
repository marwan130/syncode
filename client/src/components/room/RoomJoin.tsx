import { useEffect, useState } from 'react';
import {
  CURSOR_COLORS,
  getStoredColor,
  getStoredDisplayName,
  setStoredColor,
  setStoredDisplayName,
} from '../../utils/userStorage';

export interface RoomProfileForm {
  displayName: string;
  color: string;
  inviteLink: string;
}

interface RoomJoinProps {
  roomId?: string;
  defaultName?: string;
  mode?: 'profile' | 'create' | 'join';
  presentation?: 'popover' | 'dialog';
  currentRoomId?: string;
  onJoin?: (info: { displayName: string; color: string }) => void;
  onColorChange?: (color: string) => void;
  onStart?: (info: RoomProfileForm) => void;
  onClose: () => void;
}

export function RoomJoin({
  roomId,
  defaultName = '',
  mode = 'profile',
  presentation = 'popover',
  currentRoomId,
  onJoin,
  onColorChange,
  onStart,
  onClose,
}: RoomJoinProps) {
  const [name, setName] = useState(defaultName);
  const [selectedColor, setSelectedColor] = useState(getStoredColor);
  const [inviteLink, setInviteLink] = useState('');
  const [error, setError] = useState('');
  let linkedRoomId = '';
  if (mode === 'join' && inviteLink) {
    try {
      linkedRoomId = new URL(
        inviteLink.startsWith('/') || inviteLink.startsWith('http')
          ? inviteLink
          : `/room/${inviteLink}`,
        window.location.origin
      ).pathname.match(/\/room\/([a-zA-Z0-9_-]+)\/?$/)?.[1] ?? '';
    } catch {
      linkedRoomId = '';
    }
  }
  const lockedName =
    mode === 'profile'
      ? defaultName
      : linkedRoomId
        ? (getStoredDisplayName(linkedRoomId) ?? '')
        : '';

  useEffect(() => {
    setName(defaultName);
    setError('');
  }, [defaultName, roomId]);

  const chooseColor = (color: string) => {
    setSelectedColor(color);
    setStoredColor(color);
    onColorChange?.(color);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = (lockedName || name).trim();
    if (!trimmedName) {
      setError('Enter a name to continue.');
      return;
    }

    const info = { displayName: trimmedName, color: selectedColor };
    if (mode === 'profile' && roomId) {
      const fixedName = getStoredDisplayName(roomId) ?? trimmedName;
      setStoredDisplayName(roomId, fixedName);
      onJoin?.({ ...info, displayName: fixedName });
      onClose();
      return;
    }

    if (mode === 'join' && !inviteLink.trim()) {
      setError('Paste a room invite link.');
      return;
    }
    if (mode === 'join') {
      try {
        const invite = new URL(
          inviteLink.startsWith('/') || inviteLink.startsWith('http')
            ? inviteLink
            : `/room/${inviteLink}`,
          window.location.origin
        );
        const linkedRoom = invite.pathname.match(
          /\/room\/([a-zA-Z0-9_-]+)\/?$/
        )?.[1];
        const accessKey =
          new URLSearchParams(invite.hash.slice(1)).get('key') ?? '';
        if (!linkedRoom || !/^[0-9a-f]{64}$/i.test(accessKey)) {
          setError('Use a complete room invite link.');
          return;
        }
        if (linkedRoom === currentRoomId) {
          setError('You are already in this room.');
          return;
        }
      } catch {
        setError('Enter a valid room invite link.');
        return;
      }
    }
    onStart?.({ ...info, inviteLink: inviteLink.trim() });
  };

  const content = (
    <section
      className={`profile-popover${presentation === 'dialog' ? ' profile-dialog' : ''}`}
      role="dialog"
      aria-label={mode === 'join' ? 'Join a room' : 'Set your room profile'}
    >
      <form onSubmit={handleSubmit}>
        <input
          id="room-display-name"
          className="profile-name-input"
          type="text"
          maxLength={24}
          autoFocus={!defaultName}
          readOnly={Boolean(lockedName)}
          value={lockedName || name}
          onChange={(event) => {
            setName(event.target.value);
            setError('');
          }}
          placeholder="Enter a name"
          aria-label="Display name"
        />
        {mode === 'join' && (
          <input
            className="profile-name-input profile-link-input"
            type="text"
            autoFocus
            placeholder="Paste a room invite link"
            value={inviteLink}
            onChange={(event) => {
              setInviteLink(event.target.value);
              setError('');
            }}
            aria-label="Room invite link"
          />
        )}
        {error && <span className="profile-error">{error}</span>}

        <div className="profile-color-options" aria-label="Avatar color">
          {CURSOR_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`profile-color-option${selectedColor === color ? ' is-selected' : ''}`}
              style={{ backgroundColor: color }}
              aria-label={`Choose ${color} avatar color`}
              aria-pressed={selectedColor === color}
              onClick={() => chooseColor(color)}
            />
          ))}
        </div>

        <button className="profile-join-button" type="submit">
          {mode === 'profile'
            ? 'Save changes'
            : mode === 'create'
              ? 'Create room'
              : 'Join room'}
        </button>
      </form>
    </section>
  );

  return presentation === 'dialog' ? (
    <div className="profile-dialog-backdrop" onMouseDown={onClose}>
      <div onMouseDown={(event) => event.stopPropagation()}>{content}</div>
    </div>
  ) : (
    content
  );
}

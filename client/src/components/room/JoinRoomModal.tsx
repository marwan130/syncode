import { useEffect, useState, type FormEvent } from 'react';
import type { RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getStoredDisplayName,
  setStoredColor,
  setStoredDisplayName,
} from '../../utils/userStorage';

interface JoinRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRoomId?: string;
  currentName: string;
  currentColor: string;
  containerRef: RefObject<HTMLDivElement | null>;
}

export function JoinRoomModal({
  isOpen,
  onClose,
  currentRoomId,
  currentName,
  currentColor,
  containerRef,
}: JoinRoomModalProps) {
  const [inviteLink, setInviteLink] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (!isOpen) return;
    const dismissOnOutsidePress = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', dismissOnOutsidePress);
    return () =>
      document.removeEventListener('pointerdown', dismissOnOutsidePress);
  }, [containerRef, isOpen, onClose]);

  if (!isOpen) return null;

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentName) {
      setError('Choose a name from your avatar menu first.');
      return;
    }

    let invite: URL;
    try {
      invite = new URL(
        inviteLink.trim().startsWith('/') || inviteLink.trim().startsWith('http')
          ? inviteLink.trim()
          : `/room/${inviteLink.trim()}`,
        window.location.origin
      );
    } catch {
      setError('Enter a valid room invite link.');
      return;
    }

    const roomId = invite.pathname.match(/\/room\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
    const accessKey = new URLSearchParams(invite.hash.slice(1)).get('key') ?? '';
    if (!roomId || !/^[0-9a-f]{64}$/i.test(accessKey)) {
      setError('Use a complete room invite link.');
      return;
    }
    if (roomId === currentRoomId) {
      setError('You are already in this room.');
      return;
    }

    setStoredDisplayName(roomId, getStoredDisplayName(roomId) ?? currentName);
    setStoredColor(currentColor);
    onClose();
    navigate(`/room/${roomId}#key=${accessKey}`);
  };

  return (
    <div className="join-room-popover" role="dialog" aria-label="Join a room">
      <form onSubmit={handleJoin}>
        <input
          className="profile-name-input"
          type="text"
          autoFocus
          placeholder="Paste a room invite link"
          aria-label="Room invite link"
          value={inviteLink}
          onChange={(event) => {
            setInviteLink(event.target.value);
            setError('');
          }}
        />
        {error && <span className="profile-error">{error}</span>}
        <button className="profile-join-button" type="submit">
          Join
        </button>
      </form>
    </div>
  );
}

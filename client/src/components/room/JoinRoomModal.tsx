import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOutsidePointerDismiss } from '../../hooks/useOutsidePointerDismiss';
import { parseRoomInvite } from '../../utils/roomInvites';
import {
  getOrCreateParticipantId,
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
  const submittedRef = useRef(false);
  const navigate = useNavigate();

  useOutsidePointerDismiss(
    isOpen,
    onClose,
    (target) =>
      target instanceof Node && Boolean(containerRef.current?.contains(target))
  );

  useEffect(() => {
    if (!isOpen) return;
    submittedRef.current = false;
  }, [isOpen]);

  if (!isOpen) return null;

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittedRef.current) return;
    if (!currentName) {
      setError('Choose a name from your avatar menu first.');
      return;
    }

    const invite = parseRoomInvite(inviteLink);
    if (!invite) {
      setError('Use a complete room invite link.');
      return;
    }
    if (invite.roomId === currentRoomId) {
      setError('You are already in this room.');
      return;
    }

    submittedRef.current = true;
    setStoredDisplayName(
      invite.roomId,
      getStoredDisplayName(invite.roomId) ?? currentName
    );
    setStoredColor(currentColor, getOrCreateParticipantId(invite.roomId));
    onClose();
    navigate(`/room/${invite.roomId}#key=${invite.accessKey}`);
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

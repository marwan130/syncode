import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useOutsidePointerDismiss } from '../../hooks/useOutsidePointerDismiss';
import { validateRoomInvite } from '../../utils/roomInvites';
import { storeRoomProfile } from '../../utils/userStorage';

export interface JoinRoomModalProps {
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
  const [displayName, setDisplayName] = useState(currentName);
  const [error, setError] = useState('');
  const submittedRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();

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
    if (!currentName && !displayName.trim()) {
      setError('Enter a display name to continue.');
      return;
    }

    const validation = validateRoomInvite(inviteLink, currentRoomId);
    if (!validation.valid) {
      setError(
        validation.reason === 'same-room'
          ? 'You are already in this room.'
          : 'Use a complete room invite link.'
      );
      return;
    }
    const { invite } = validation;

    submittedRef.current = true;
    storeRoomProfile(
      invite.roomId,
      currentName || displayName.trim(),
      currentColor
    );
    onClose();
    navigate(`/room/${invite.roomId}#key=${invite.accessKey}`, {
      state: {
        returnTo: currentRoomId
          ? `${location.pathname}${location.search}${location.hash}`
          : null,
      },
    });
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
        {!currentName && (
          <input
            className="profile-name-input join-room-name-input"
            type="text"
            maxLength={24}
            autoComplete="nickname"
            placeholder="Enter a display name"
            aria-label="Display name"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setError('');
            }}
          />
        )}
        {error && <span className="profile-error">{error}</span>}
        <button
          className="room-leave-button profile-leave-button join-room-submit-button"
          type="submit"
        >
          Join
        </button>
      </form>
    </div>
  );
}

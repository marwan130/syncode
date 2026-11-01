import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { getRoomIdFromInvite, type RoomInvite } from '../../utils/roomInvites';
import {
  getRoomJoinValidationMessage,
  validateRoomJoinForm,
} from './roomJoinForm';
import {
  CURSOR_COLORS,
  getStoredColor,
  getStoredDisplayName,
  setStoredColor,
  storeRoomProfile,
} from '../../utils/userStorage';
import { useAppActivity } from '../shared/useAppActivity';
import { GithubLoginButton } from '../github/GithubLoginButton';

export interface RoomProfileForm {
  displayName: string;
  color: string;
  invite?: RoomInvite;
}

export interface RoomJoinProps {
  roomId?: string;
  defaultName?: string;
  mode?: 'profile' | 'create' | 'join';
  presentation?: 'popover' | 'dialog';
  colorStorageId?: string;
  currentRoomId?: string;
  onJoin?: (info: { displayName: string; color: string }) => void;
  onColorChange?: (color: string) => void;
  leaving?: boolean;
  onLeaveRoom?: () => Promise<void>;
  onStart?: (info: RoomProfileForm) => void | Promise<void>;
  onClose: () => void;
}

export function RoomJoin({
  roomId,
  defaultName = '',
  mode = 'profile',
  presentation = 'popover',
  colorStorageId,
  currentRoomId,
  onJoin,
  onColorChange,
  leaving = false,
  onLeaveRoom,
  onStart,
  onClose,
}: RoomJoinProps) {
  const { runActivity } = useAppActivity();
  const [name, setName] = useState(defaultName);
  const [selectedColor, setSelectedColor] = useState(() =>
    getStoredColor(colorStorageId)
  );
  const [inviteLink, setInviteLink] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const linkedRoomId = mode === 'join' ? getRoomIdFromInvite(inviteLink) : null;
  const lockedName = getLockedName(mode, defaultName, linkedRoomId);

  const chooseColor = (color: string) => {
    setSelectedColor(color);
    setStoredColor(color, colorStorageId);
    onColorChange?.(color);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateRoomJoinForm({
      mode,
      name,
      lockedName,
      inviteLink,
      currentRoomId,
    });
    if (!validation.valid) {
      setError(getRoomJoinValidationMessage(validation.reason));
      return;
    }

    const info = { displayName: validation.displayName, color: selectedColor };
    if (mode === 'profile' && roomId) {
      const fixedName = storeRoomProfile(
        roomId,
        validation.displayName,
        selectedColor,
        colorStorageId
      );
      onJoin?.({ ...info, displayName: fixedName });
      onClose();
      return;
    }

    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const label = mode === 'create' ? 'Creating room…' : 'Joining room…';
      await runActivity(label, () =>
        Promise.resolve(onStart?.({ ...info, invite: validation.invite }))
      );
    } catch {
      setError('Could not continue. Please try again.');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const content = (
    <section
      className={`profile-popover${presentation === 'dialog' ? ' profile-dialog' : ''}`}
      role="dialog"
      aria-label={mode === 'join' ? 'Join a room' : 'Set your room profile'}
    >
      <form onSubmit={handleSubmit}>
        <RoomNameInput
          name={lockedName || name}
          locked={Boolean(lockedName)}
          autoFocus={!defaultName}
          onChange={(value) => {
            setName(value);
            setError('');
          }}
        />
        {mode === 'join' && (
          <RoomInviteInput
            value={inviteLink}
            onChange={(value) => {
              setInviteLink(value);
              setError('');
            }}
          />
        )}
        {error && <span className="profile-error">{error}</span>}
        <RoomColorOptions
          selectedColor={selectedColor}
          onSelect={chooseColor}
        />
        {mode !== 'profile' && (
          <RoomJoinSubmitButton mode={mode} isSubmitting={isSubmitting} />
        )}
      </form>
      {mode === 'profile' && (
        <GithubLoginButton
          returnTo={`${window.location.pathname}${window.location.search}${window.location.hash}`}
          className="profile-github-button"
        />
      )}
      {mode === 'profile' && onLeaveRoom && (
        <button
          className="room-leave-button profile-leave-button"
          type="button"
          onClick={() => void onLeaveRoom()}
          disabled={leaving}
        >
          {leaving ? 'Leaving…' : 'Leave room'}
        </button>
      )}
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

function getLockedName(
  mode: RoomJoinProps['mode'],
  defaultName: string,
  linkedRoomId: string | null
): string {
  if (mode === 'profile') return defaultName;
  if (!linkedRoomId) return '';
  return getStoredDisplayName(linkedRoomId) ?? '';
}

function RoomNameInput({
  name,
  locked,
  autoFocus,
  onChange,
}: {
  name: string;
  locked: boolean;
  autoFocus: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <input
      id="room-display-name"
      className="profile-name-input"
      type="text"
      maxLength={24}
      autoFocus={autoFocus}
      readOnly={locked}
      value={name}
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        onChange(event.target.value)
      }
      placeholder="Enter a name"
      aria-label="Display name"
    />
  );
}

function RoomInviteInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      className="profile-name-input profile-link-input"
      type="text"
      autoFocus
      placeholder="Paste a room invite link"
      value={value}
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        onChange(event.target.value)
      }
      aria-label="Room invite link"
    />
  );
}

function RoomColorOptions({
  selectedColor,
  onSelect,
}: {
  selectedColor: string;
  onSelect: (color: string) => void;
}) {
  return (
    <div className="profile-color-options" aria-label="Avatar color">
      {CURSOR_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`profile-color-option${selectedColor === color ? ' is-selected' : ''}`}
          style={{ backgroundColor: color }}
          aria-label={`${color} avatar color${selectedColor === color ? ', selected' : ''}`}
          aria-pressed={selectedColor === color}
          onClick={() => onSelect(color)}
        />
      ))}
    </div>
  );
}

function RoomJoinSubmitButton({
  mode,
  isSubmitting,
}: {
  mode: 'create' | 'join';
  isSubmitting: boolean;
}) {
  return (
    <button
      className={`profile-join-button${mode === 'create' ? ' is-create' : ''}`}
      type="submit"
      disabled={isSubmitting}
    >
      {isSubmitting
        ? 'Please wait…'
        : mode === 'create'
          ? 'Create room'
          : 'Join room'}
    </button>
  );
}

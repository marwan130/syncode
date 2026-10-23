import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AwarenessState } from '../../providers/SignalRCrdtProvider';
import { useOutsidePointerDismiss } from '../../hooks/useOutsidePointerDismiss';
import { RoomJoin } from './RoomJoin';
import { Avatar } from './Avatar';

export interface ParticipantListProps {
  roomId: string;
  participantId: string;
  localName: string;
  localColor: string;
  localAvatarUrl?: string;
  peers: Map<string, AwarenessState>;
  isAdmin: boolean;
  onToggleLock: (connectionId: string) => Promise<void>;
  onSetAdmin: (connectionId: string, isAdmin: boolean) => Promise<void>;
  onKick: (connectionId: string) => Promise<void>;
  onJoinProfile: (info: { displayName: string; color: string }) => void;
  onColorChange: (color: string) => void;
}

export function ParticipantList({
  roomId,
  participantId,
  localName,
  localColor,
  localAvatarUrl,
  peers,
  isAdmin,
  onToggleLock,
  onSetAdmin,
  onKick,
  onJoinProfile,
  onColorChange,
}: ParticipantListProps) {
  const [profileState, setProfileState] = useState(() => ({
    roomId,
    isOpen: !localName,
  }));
  const isProfileOpen =
    profileState.roomId === roomId ? profileState.isOpen : !localName;
  const setProfileOpen = (isOpen: boolean) =>
    setProfileState({ roomId, isOpen });
  const profileAnchorRef = useRef<HTMLDivElement>(null);
  const stacked = peers.size + 1 > 3;

  useOutsidePointerDismiss(
    isProfileOpen,
    () => setProfileOpen(false),
    (target) =>
      target instanceof Node &&
      Boolean(profileAnchorRef.current?.contains(target))
  );

  return (
    <div
      className={`participant-list${stacked ? ' is-stacked' : ''}`}
      role="group"
      aria-label={`${peers.size + 1} room participants`}
    >
      <div className="profile-anchor" ref={profileAnchorRef}>
        <button
          type="button"
          onClick={() => setProfileOpen(!isProfileOpen)}
          title="Edit your avatar color"
          aria-label="Edit your name and avatar color"
          aria-expanded={isProfileOpen}
          aria-haspopup="dialog"
          className="profile-avatar-button"
        >
          <Avatar
            name={localName || '?'}
            color={localColor}
            avatarUrl={localAvatarUrl}
            title={localName ? `${localName} (you)` : 'Choose your name'}
            cursor="pointer"
          />
        </button>
        {isProfileOpen && (
          <RoomJoin
            key={`${roomId}:${localName}`}
            roomId={roomId}
            colorStorageId={participantId}
            defaultName={localName}
            onJoin={(info) => {
              onJoinProfile(info);
              setProfileOpen(false);
            }}
            onColorChange={onColorChange}
            onClose={() => setProfileOpen(false)}
          />
        )}
      </div>
      {Array.from(peers.entries(), ([peerId, peer], index) => (
        <ParticipantItem
          key={peerId}
          peerId={peerId}
          peer={peer}
          index={index}
          stacked={stacked}
          canManage={isAdmin}
          onToggleLock={onToggleLock}
          onSetAdmin={onSetAdmin}
          onKick={onKick}
        />
      ))}
    </div>
  );
}

interface ParticipantItemProps {
  peerId: string;
  peer: AwarenessState;
  index: number;
  stacked: boolean;
  canManage: boolean;
  onToggleLock: (connectionId: string) => Promise<void>;
  onSetAdmin: (connectionId: string, isAdmin: boolean) => Promise<void>;
  onKick: (connectionId: string) => Promise<void>;
}

function ParticipantItem({
  peerId,
  peer,
  index,
  stacked,
  canManage,
  onToggleLock,
  onSetAdmin,
  onKick,
}: ParticipantItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const style = getStackStyle(stacked, index, menuOpen);

  useOutsidePointerDismiss(
    menuOpen,
    () => setMenuOpen(false),
    (target) =>
      target instanceof Node && Boolean(anchorRef.current?.contains(target))
  );

  if (!canManage)
    return (
      <div className="participant-avatar-wrap" style={style}>
        <Avatar
          name={peer.name}
          color={peer.color}
          avatarUrl={peer.avatarUrl}
        />
      </div>
    );

  return (
    <div ref={anchorRef} className="participant-manage-anchor" style={style}>
      <button
        type="button"
        className={`participant-avatar-action${peer.isLocked ? ' is-locked' : ''}`}
        data-hint={`Manage ${peer.name}`}
        aria-label={`Manage ${peer.name}`}
        aria-expanded={menuOpen}
        aria-haspopup="true"
        disabled={pending}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Avatar
          name={peer.name}
          color={peer.color}
          avatarUrl={peer.avatarUrl}
        />
        {peer.isLocked && <ParticipantLockMark />}
      </button>
      {menuOpen && (
        <ParticipantManageMenu
          peer={peer}
          pending={pending}
          onClose={() => setMenuOpen(false)}
          onAction={(action) => {
            setPending(true);
            setMenuOpen(false);
            void action(peerId).finally(() => setPending(false));
          }}
          onToggleLock={onToggleLock}
          onSetAdmin={onSetAdmin}
          onKick={onKick}
        />
      )}
    </div>
  );
}

function getStackStyle(
  stacked: boolean,
  index: number,
  menuOpen: boolean
): CSSProperties | undefined {
  if (!stacked) return undefined;
  return {
    marginLeft: -8,
    transform: `translateY(${index % 2 === 0 ? -2 : 2}px)`,
    zIndex: menuOpen ? 100 : index + 1,
  };
}

function ParticipantManageMenu({
  peer,
  pending,
  onClose,
  onAction,
  onToggleLock,
  onSetAdmin,
  onKick,
}: {
  peer: AwarenessState;
  pending: boolean;
  onClose: () => void;
  onAction: (action: (connectionId: string) => Promise<void>) => void;
  onToggleLock: (connectionId: string) => Promise<void>;
  onSetAdmin: (connectionId: string, isAdmin: boolean) => Promise<void>;
  onKick: (connectionId: string) => Promise<void>;
}) {
  return (
    <div
      className="participant-manage-menu"
      aria-label={`Manage ${peer.name}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      {peer.isAdmin ? (
        <ParticipantActionButton
          pending={pending}
          label="Remove admin role"
          onClick={() => onAction((id) => onSetAdmin(id, false))}
        />
      ) : (
        <>
          <ParticipantActionButton
            pending={pending}
            label={peer.isLocked ? 'Allow editing' : 'Prevent editing'}
            onClick={() => onAction(onToggleLock)}
          />
          <ParticipantActionButton
            pending={pending}
            label="Make admin"
            onClick={() => onAction((id) => onSetAdmin(id, true))}
          />
        </>
      )}
      <ParticipantActionButton
        pending={pending}
        label="Kick from room"
        onClick={() => onAction(onKick)}
      />
    </div>
  );
}

function ParticipantActionButton({
  pending,
  label,
  onClick,
}: {
  pending: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" disabled={pending} onClick={onClick}>
      {label}
    </button>
  );
}

function ParticipantLockMark() {
  return (
    <span className="participant-lock-mark" aria-hidden="true">
      <svg
        viewBox="0 0 12 12"
        width="8"
        height="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      >
        <rect x="2.5" y="5.2" width="7" height="5" rx="0.8" />
        <path d="M4 5V3.6a2 2 0 0 1 4 0V5" />
      </svg>
    </span>
  );
}

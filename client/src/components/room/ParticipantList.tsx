import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AwarenessState, RoomJoinRequest } from '../../providers/SignalRCrdtProvider';
import { useOutsidePointerDismiss } from '../../hooks/useOutsidePointerDismiss';
import { RoomJoin } from './RoomJoin';
import { Avatar } from './Avatar';

export interface ParticipantProfileProps {
  roomId: string;
  participantId: string;
  localName: string;
  localColor: string;
  localAvatarUrl?: string;
  onJoinProfile: (info: { displayName: string; color: string }) => void;
  onColorChange: (color: string) => void;
}

export interface ParticipantManagementActions {
  isAdmin: boolean;
  onToggleLock: (connectionId: string) => Promise<void>;
  onSetAdmin: (connectionId: string, isAdmin: boolean) => Promise<void>;
  onKick: (connectionId: string) => Promise<void>;
}

export interface ParticipantListProps {
  profile: ParticipantProfileProps;
  peers: Map<string, AwarenessState>;
  management: ParticipantManagementActions;
  joinRequests: RoomJoinRequest[];
  onApproveJoinRequest: (requestId: string) => Promise<void>;
  onRejectJoinRequest: (requestId: string) => Promise<void>;
}

export function ParticipantList({
  profile,
  peers,
  management,
  joinRequests,
  onApproveJoinRequest,
  onRejectJoinRequest,
}: ParticipantListProps) {
  const stacked = peers.size + 1 > 3;

  return (
    <div
      className={`participant-list${stacked ? ' is-stacked' : ''}`}
      role="group"
      aria-label={`${peers.size + 1} room participants`}
    >
      <ParticipantProfile profile={profile} />
      {Array.from(peers.entries(), ([peerId, peer], index) => (
        <ParticipantItem
          key={peerId}
          peerId={peerId}
          peer={peer}
          index={index}
          stacked={stacked}
          management={management}
        />
      ))}
      {management.isAdmin && joinRequests.length > 0 && (
        <JoinRequestControl
          requests={joinRequests}
          onApprove={onApproveJoinRequest}
          onReject={onRejectJoinRequest}
        />
      )}
    </div>
  );
}

function JoinRequestControl({
  requests,
  onApprove,
  onReject,
}: {
  requests: RoomJoinRequest[];
  onApprove: (requestId: string) => Promise<void>;
  onReject: (requestId: string) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const anchorRef = useRef<HTMLDivElement>(null);

  useOutsidePointerDismiss(
    isOpen,
    () => setIsOpen(false),
    (target) => isProfileAnchorTarget(target, anchorRef.current)
  );

  const actOnRequest = async (
    requestId: string,
    action: (id: string) => Promise<void>
  ) => {
    setPendingRequestId(requestId);
    setError('');
    try {
      await action(requestId);
    } catch {
      setError('Could not update the join request. Try again.');
    } finally {
      setPendingRequestId(null);
    }
  };

  return (
    <div ref={anchorRef} className="join-request-anchor">
      <button
        type="button"
        className="join-request-toggle"
        aria-expanded={isOpen}
        aria-haspopup="true"
        onClick={() => setIsOpen((open) => !open)}
      >
        Join requests <span>{requests.length}</span>
      </button>
      {isOpen && (
        <div className="participant-manage-menu join-request-menu" aria-label="Room join requests">
          {error && <div className="join-request-error" role="alert">{error}</div>}
          {requests.map((request) => (
            <div className="join-request-item" key={request.requestId}>
              <Avatar
                name={request.displayName}
                color={request.color}
                avatarUrl={request.avatarUrl}
              />
              <span className="join-request-name">{request.displayName}</span>
              <button
                type="button"
                disabled={pendingRequestId === request.requestId}
                onClick={() => void actOnRequest(request.requestId, onApprove)}
              >
                Approve
              </button>
              <button
                type="button"
                disabled={pendingRequestId === request.requestId}
                onClick={() => void actOnRequest(request.requestId, onReject)}
              >
                Decline
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ParticipantProfile({ profile }: { profile: ParticipantProfileProps }) {
  const {
    roomId,
    participantId,
    localName,
    localColor,
    localAvatarUrl,
    onJoinProfile,
    onColorChange,
  } = profile;
  const [profileState, setProfileState] = useState(() => ({
    roomId,
    isOpen: !localName,
  }));
  const isProfileOpen = getProfileOpenState(profileState, roomId, localName);
  const setProfileOpen = (isOpen: boolean) =>
    setProfileState({ roomId, isOpen });
  const profileAnchorRef = useRef<HTMLDivElement>(null);

  useOutsidePointerDismiss(
    isProfileOpen,
    () => setProfileOpen(false),
    (target) => isProfileAnchorTarget(target, profileAnchorRef.current)
  );

  return (
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
  );
}

function getProfileOpenState(
  state: { roomId: string; isOpen: boolean },
  roomId: string,
  localName: string
): boolean {
  return state.roomId === roomId ? state.isOpen : !localName;
}

function isProfileAnchorTarget(
  target: EventTarget | null,
  anchor: HTMLDivElement | null
): boolean {
  return target instanceof Node && Boolean(anchor?.contains(target));
}


interface ParticipantItemProps {
  peerId: string;
  peer: AwarenessState;
  index: number;
  stacked: boolean;
  management: ParticipantManagementActions;
}

function ParticipantItem({
  peerId,
  peer,
  index,
  stacked,
  management,
}: ParticipantItemProps) {
  if (!management.isAdmin)
    return (
      <div
        className="participant-avatar-wrap"
        style={getStackStyle(stacked, index, false)}
      >
        <Avatar name={peer.name} color={peer.color} avatarUrl={peer.avatarUrl} />
      </div>
    );

  return (
    <ManagedParticipantItem
      peerId={peerId}
      peer={peer}
      index={index}
      stacked={stacked}
      management={management}
    />
  );
}

function ManagedParticipantItem({
  peerId,
  peer,
  index,
  stacked,
  management,
}: ParticipantItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const style = getStackStyle(stacked, index, menuOpen);

  useOutsidePointerDismiss(
    menuOpen,
    () => setMenuOpen(false),
    (target) => isProfileAnchorTarget(target, anchorRef.current)
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
          management={management}
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
  management,
}: {
  peer: AwarenessState;
  pending: boolean;
  onClose: () => void;
  onAction: (action: (connectionId: string) => Promise<void>) => void;
  management: ParticipantManagementActions;
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
          onClick={() => onAction((id) => management.onSetAdmin(id, false))}
        />
      ) : (
        <>
          <ParticipantActionButton
            pending={pending}
            label={peer.isLocked ? 'Allow editing' : 'Prevent editing'}
            onClick={() => onAction(management.onToggleLock)}
          />
          <ParticipantActionButton
            pending={pending}
            label="Make admin"
            onClick={() => onAction((id) => management.onSetAdmin(id, true))}
          />
        </>
      )}
      <ParticipantActionButton
        pending={pending}
        label="Kick from room"
        onClick={() => onAction(management.onKick)}
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
    <button
      className="participant-action-button"
      type="button"
      disabled={pending}
      onClick={onClick}
    >
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

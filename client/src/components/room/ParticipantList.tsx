import { useRef, useState } from 'react';
import type { AwarenessState } from '../../providers/SignalRCrdtProvider';
import { useOutsidePointerDismiss } from '../../hooks/useOutsidePointerDismiss';
import { RoomJoin } from './RoomJoin';
import { Avatar } from './Avatar';

interface ParticipantListProps {
  roomId: string;
  participantId: string;
  localName: string;
  localColor: string;
  peers: Map<string, AwarenessState>;
  isAdmin: boolean;
  onToggleLock: (connectionId: string) => Promise<void>;
  onSetAdmin: (connectionId: string, isAdmin: boolean) => Promise<void>;
  onJoinProfile: (info: { displayName: string; color: string }) => void;
  onColorChange: (color: string) => void;
}

export function ParticipantList({
  roomId,
  participantId,
  localName,
  localColor,
  peers,
  isAdmin,
  onToggleLock,
  onSetAdmin,
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
  const [pendingActions, setPendingActions] = useState<Set<string>>(
    () => new Set()
  );
  const [openParticipantId, setOpenParticipantId] = useState<string | null>(
    null
  );
  const profileAnchorRef = useRef<HTMLDivElement>(null);
  const stacked = peers.size + 1 > 3;

  useOutsidePointerDismiss(
    isProfileOpen,
    () => setProfileOpen(false),
    (target) =>
      target instanceof Node &&
      Boolean(profileAnchorRef.current?.contains(target))
  );

  useOutsidePointerDismiss(
    Boolean(openParticipantId),
    () => setOpenParticipantId(null),
    (target) =>
      target instanceof Element &&
      Boolean(target.closest('.participant-manage-anchor'))
  );

  const runParticipantAction = (
    connectionId: string,
    action: (connectionId: string) => Promise<void>
  ) => {
    setPendingActions((current) => new Set(current).add(connectionId));
    setOpenParticipantId(null);
    void action(connectionId).finally(() => {
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(connectionId);
        return next;
      });
    });
  };

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
            title={localName ? `${localName} (you)` : 'Choose your name'}
            cursor="pointer"
          />
        </button>
        {isProfileOpen && (
          <RoomJoin
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
      {Array.from(peers.entries()).map(([peerId, peer], index) => {
        const style = stacked
          ? {
              marginLeft: -8,
              transform: `translateY(${index % 2 === 0 ? -2 : 2}px)`,
              zIndex: index + 1,
            }
          : undefined;
        if (isAdmin) {
          const menuOpen = openParticipantId === peerId;
          return (
            <div
              key={peerId}
              className="participant-manage-anchor"
              style={menuOpen && style ? { ...style, zIndex: 100 } : style}
            >
              <button
                type="button"
                className={`participant-avatar-action${peer.isLocked ? ' is-locked' : ''}`}
                data-hint={`Manage ${peer.name}`}
                aria-label={`Manage ${peer.name}`}
                aria-expanded={menuOpen}
                aria-haspopup="true"
                disabled={pendingActions.has(peerId)}
                onClick={() => setOpenParticipantId(menuOpen ? null : peerId)}
              >
                <Avatar name={peer.name} color={peer.color} />
                {peer.isLocked && (
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
                )}
              </button>
              {menuOpen && (
                <div
                  className="participant-manage-menu"
                  aria-label={`Manage ${peer.name}`}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setOpenParticipantId(null);
                  }}
                >
                  {peer.isAdmin ? (
                    <button
                      type="button"
                      disabled={pendingActions.has(peerId)}
                      onClick={() =>
                        runParticipantAction(peerId, (id) =>
                          onSetAdmin(id, false)
                        )
                      }
                    >
                      Remove admin role
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={pendingActions.has(peerId)}
                        onClick={() =>
                          runParticipantAction(peerId, onToggleLock)
                        }
                      >
                        {peer.isLocked ? 'Allow editing' : 'Prevent editing'}
                      </button>
                      <button
                        type="button"
                        disabled={pendingActions.has(peerId)}
                        onClick={() =>
                          runParticipantAction(peerId, (id) =>
                            onSetAdmin(id, true)
                          )
                        }
                      >
                        Make admin
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        }

        return (
          <div key={peerId} className="participant-avatar-wrap" style={style}>
            <Avatar name={peer.name} color={peer.color} />
          </div>
        );
      })}
    </div>
  );
}

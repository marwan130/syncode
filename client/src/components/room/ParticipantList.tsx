import { useEffect, useRef, useState } from 'react';
import type { AwarenessState } from '../../providers/SignalRCrdtProvider';
import { RoomJoin } from './RoomJoin';
import { Avatar } from './Avatar';

interface ParticipantListProps {
  roomId: string;
  localName: string;
  localColor: string;
  peers: Map<string, AwarenessState>;
  onJoinProfile: (info: { displayName: string; color: string }) => void;
  onColorChange: (color: string) => void;
}

export function ParticipantList({
  roomId,
  localName,
  localColor,
  peers,
  onJoinProfile,
  onColorChange,
}: ParticipantListProps) {
  const [isProfileOpen, setProfileOpen] = useState(!localName);
  const profileAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!localName) setProfileOpen(true);
  }, [localName, roomId]);

  useEffect(() => {
    if (!isProfileOpen) return;
    const dismissOnOutsidePress = (event: PointerEvent) => {
      if (!profileAnchorRef.current?.contains(event.target as Node))
        setProfileOpen(false);
    };
    document.addEventListener('pointerdown', dismissOnOutsidePress);
    return () =>
      document.removeEventListener('pointerdown', dismissOnOutsidePress);
  }, [isProfileOpen]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div className="profile-anchor" ref={profileAnchorRef}>
        <button
          type="button"
          onClick={() => setProfileOpen((open) => !open)}
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
      {Array.from(peers.entries()).map(([peerId, peer]) => (
        <Avatar key={peerId} name={peer.name} color={peer.color} />
      ))}
    </div>
  );
}

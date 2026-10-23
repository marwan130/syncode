import { useRef, useState } from 'react';
import type { AwarenessState } from '../../providers/SignalRCrdtProvider';
import { useLocation } from 'react-router-dom';
import { GithubLoginButton } from '../github/GithubLoginButton';
import { JoinRoomModal } from './JoinRoomModal';
import { ParticipantList } from './ParticipantList';
import { ShareLinkButton } from './ShareLinkButton';

export interface RoomHeaderActionsProps {
  roomId: string;
  participantId: string;
  localName: string;
  localColor: string;
  localAvatarUrl?: string;
  peers: Map<string, AwarenessState>;
  isAdmin: boolean;
  onToggleParticipantLock: (connectionId: string) => Promise<void>;
  onSetParticipantAdmin: (
    connectionId: string,
    isAdmin: boolean
  ) => Promise<void>;
  onKickParticipant: (connectionId: string) => Promise<void>;
  onJoinProfile: (info: { displayName: string; color: string }) => void;
  onColorChange: (color: string) => void;
}

export function RoomHeaderActions({
  roomId,
  participantId,
  localName,
  localColor,
  localAvatarUrl,
  peers,
  isAdmin,
  onToggleParticipantLock,
  onSetParticipantAdmin,
  onKickParticipant,
  onJoinProfile,
  onColorChange,
}: RoomHeaderActionsProps) {
  const [isJoinModalOpen, setJoinModalOpen] = useState(false);
  const joinAnchorRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  return (
    <>
      <div className="room-join-anchor" ref={joinAnchorRef}>
        <button
          className="room-join-toggle"
          type="button"
          onClick={() => setJoinModalOpen((open) => !open)}
          title="Join another room with a link"
          aria-expanded={isJoinModalOpen}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
          <span>Join</span>
        </button>
        <JoinRoomModal
          isOpen={isJoinModalOpen}
          currentRoomId={roomId}
          currentName={localName}
          currentColor={localColor}
          containerRef={joinAnchorRef}
          onClose={() => setJoinModalOpen(false)}
        />
      </div>

      <ShareLinkButton />

      <GithubLoginButton
        returnTo={`${location.pathname}${location.search}${location.hash}`}
      />

      <ParticipantList
        roomId={roomId}
        participantId={participantId}
        localName={localName}
        localColor={localColor}
        localAvatarUrl={localAvatarUrl}
        peers={peers}
        isAdmin={isAdmin}
        onToggleLock={onToggleParticipantLock}
        onSetAdmin={onSetParticipantAdmin}
        onKick={onKickParticipant}
        onJoinProfile={onJoinProfile}
        onColorChange={onColorChange}
      />
    </>
  );
}

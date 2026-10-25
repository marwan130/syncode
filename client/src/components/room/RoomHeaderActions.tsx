import { useRef, useState } from 'react';
import type { AwarenessState, RoomJoinRequest } from '../../providers/SignalRCrdtProvider';
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
  joinRequests: RoomJoinRequest[];
  onApproveJoinRequest: (requestId: string) => Promise<void>;
  onRejectJoinRequest: (requestId: string) => Promise<void>;
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
  joinRequests,
  onApproveJoinRequest,
  onRejectJoinRequest,
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
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 3h5v18h-5" />
            <path d="M3 12h12m-5-5 5 5-5 5" />
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
        profile={{
          roomId,
          participantId,
          localName,
          localColor,
          localAvatarUrl,
          onJoinProfile,
          onColorChange,
        }}
        peers={peers}
        management={{
          isAdmin,
          onToggleLock: onToggleParticipantLock,
          onSetAdmin: onSetParticipantAdmin,
          onKick: onKickParticipant,
        }}
        joinRequests={joinRequests}
        onApproveJoinRequest={onApproveJoinRequest}
        onRejectJoinRequest={onRejectJoinRequest}
      />
    </>
  );
}

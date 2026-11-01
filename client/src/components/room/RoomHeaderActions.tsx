import { useRef, useState } from 'react';
import { JoinRoomModal } from './JoinRoomModal';
import { ParticipantList } from './ParticipantList';
import { ShareLinkButton } from './ShareLinkButton';
import { useAppFeedback } from '../shared/useAppFeedback';
import { useAppActivity } from '../shared/useAppActivity';
import type {
  RoomHeaderProfileProps,
  RoomParticipantManagementProps,
} from './roomHeaderTypes';

export type RoomHeaderActionsProps = RoomHeaderProfileProps &
  RoomParticipantManagementProps;

export function RoomHeaderActions({
  roomId,
  participantId,
  localName,
  localColor,
  localAvatarUrl,
  canLeaveRoom,
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
  onLeaveRoom,
}: RoomHeaderActionsProps) {
  const [isJoinModalOpen, setJoinModalOpen] = useState(false);
  const joinAnchorRef = useRef<HTMLDivElement>(null);
  const { showMessage } = useAppFeedback();
  const { runActivity } = useAppActivity();
  const [leaving, setLeaving] = useState(false);

  async function leaveRoom() {
    if (leaving) return;
    setLeaving(true);
    try {
      await runActivity('Leaving room…', onLeaveRoom);
    } catch {
      setLeaving(false);
      await showMessage('Could not leave the room. Reconnect and try again.');
    }
  }

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

      <ParticipantList
        profile={{
          roomId,
          participantId,
          localName,
          localColor,
          localAvatarUrl,
          canLeaveRoom,
          leaving,
          onJoinProfile,
          onColorChange,
          onLeaveRoom: canLeaveRoom ? leaveRoom : undefined,
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

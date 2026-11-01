import type {
  AwarenessState,
  RoomJoinRequest,
} from '../../providers/SignalRCrdtProvider';

export interface RoomHeaderProfileProps {
  roomId: string;
  participantId: string;
  localName: string;
  localColor: string;
  localAvatarUrl?: string;
  canLeaveRoom: boolean;
  onJoinProfile: (info: { displayName: string; color: string }) => void;
  onColorChange: (color: string) => void;
  onLeaveRoom: () => Promise<void>;
}

export interface RoomParticipantManagementProps {
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
}

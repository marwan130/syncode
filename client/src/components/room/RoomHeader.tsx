import type { AwarenessState, RoomJoinRequest } from '../../providers/SignalRCrdtProvider';
import type { Monaco } from '@monaco-editor/react';
import { RoomHeaderToolbar } from './RoomHeaderToolbar';
import { RoomHeaderActions } from './RoomHeaderActions';

export interface RoomHeaderProps {
  roomId: string;
  participantId: string;
  localName: string;
  localColor: string;
  localAvatarUrl?: string;
  onJoinProfile: (info: { displayName: string; color: string }) => void;
  onColorChange: (color: string) => void;
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
  monaco: Monaco | null;
  autocompleteEnabled: boolean;
  onAutocompleteChange: (enabled: boolean) => void;
  showPreviewButton: boolean;
  onShowPreview: () => void;
}

export function RoomHeader({
  roomId,
  participantId,
  localName,
  localColor,
  localAvatarUrl,
  onJoinProfile,
  onColorChange,
  peers,
  isAdmin,
  onToggleParticipantLock,
  onSetParticipantAdmin,
  onKickParticipant,
  joinRequests,
  onApproveJoinRequest,
  onRejectJoinRequest,
  monaco,
  autocompleteEnabled,
  onAutocompleteChange,
  showPreviewButton,
  onShowPreview,
}: RoomHeaderProps) {
  return (
    <header className="room-header">
      <RoomHeaderLeft />
      <div className="room-header-right">
        <RoomHeaderToolbar
          monaco={monaco}
          autocompleteEnabled={autocompleteEnabled}
          onAutocompleteChange={onAutocompleteChange}
          showPreviewButton={showPreviewButton}
          onShowPreview={onShowPreview}
        />
        <RoomHeaderActions
          roomId={roomId}
          participantId={participantId}
          localName={localName}
          localColor={localColor}
          localAvatarUrl={localAvatarUrl}
          peers={peers}
          isAdmin={isAdmin}
          onToggleParticipantLock={onToggleParticipantLock}
          onSetParticipantAdmin={onSetParticipantAdmin}
          onKickParticipant={onKickParticipant}
          joinRequests={joinRequests}
          onApproveJoinRequest={onApproveJoinRequest}
          onRejectJoinRequest={onRejectJoinRequest}
          onJoinProfile={onJoinProfile}
          onColorChange={onColorChange}
        />
      </div>
    </header>
  );
}

function RoomHeaderLeft() {
  return (
    <div className="room-header-left">
      <span className="syncode-brand" aria-label="Syncode">
        syncode
      </span>
    </div>
  );
}

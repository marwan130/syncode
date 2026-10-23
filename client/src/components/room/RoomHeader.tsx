import type * as monaco from 'monaco-editor';
import type {
  ConnectionStatus,
  AwarenessState,
} from '../../providers/SignalRCrdtProvider';
import { RoomHeaderToolbar } from './RoomHeaderToolbar';
import type { Monaco } from '@monaco-editor/react';
import { RoomHeaderActions } from './RoomHeaderActions';

export interface RoomHeaderProps {
  roomId: string;
  participantId: string;
  status: ConnectionStatus;
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
  editor: monaco.editor.IStandaloneCodeEditor | null;
  monaco: Monaco | null;
  autocompleteEnabled: boolean;
  onAutocompleteChange: (enabled: boolean) => void;
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  isChatOpen: boolean;
  onToggleChat: () => void;
  showPreviewButton: boolean;
  onShowPreview: () => void;
  canRunCode: boolean;
  runDisabledReason?: string;
  isRunningCode: boolean;
  onRunCode: () => void;
  onOpenTerminal: () => void;
}

export function RoomHeader({
  roomId,
  participantId,
  status,
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
  editor,
  monaco,
  autocompleteEnabled,
  onAutocompleteChange,
  explorerOpen,
  onToggleExplorer,
  isChatOpen,
  onToggleChat,
  showPreviewButton,
  onShowPreview,
  canRunCode,
  runDisabledReason,
  isRunningCode,
  onRunCode,
  onOpenTerminal,
}: RoomHeaderProps) {
  return (
    <header className="room-header">
      <RoomHeaderLeft
        explorerOpen={explorerOpen}
        onToggleExplorer={onToggleExplorer}
        isChatOpen={isChatOpen}
        onToggleChat={onToggleChat}
      />
      <div className="room-header-right">
        <RoomHeaderToolbar
          status={status}
          editor={editor}
          monaco={monaco}
          autocompleteEnabled={autocompleteEnabled}
          onAutocompleteChange={onAutocompleteChange}
          showPreviewButton={showPreviewButton}
          onShowPreview={onShowPreview}
          canRunCode={canRunCode}
          runDisabledReason={runDisabledReason}
          isRunningCode={isRunningCode}
          onRunCode={onRunCode}
          onOpenTerminal={onOpenTerminal}
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
          onJoinProfile={onJoinProfile}
          onColorChange={onColorChange}
        />
      </div>
    </header>
  );
}

function RoomHeaderLeft({
  explorerOpen,
  onToggleExplorer,
  isChatOpen,
  onToggleChat,
}: {
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  isChatOpen: boolean;
  onToggleChat: () => void;
}) {
  return (
    <div className="room-header-left">
      <button
        className="syncode-brand-toggle"
        type="button"
        title={explorerOpen ? 'Hide file explorer' : 'Show file explorer'}
        aria-label={explorerOpen ? 'Hide file explorer' : 'Show file explorer'}
        aria-expanded={explorerOpen}
        aria-keyshortcuts="Control+Alt+E"
        onClick={onToggleExplorer}
      >
        syncode
      </button>
      <button
        className={`chat-toggle${isChatOpen ? ' is-active' : ''}`}
        type="button"
        aria-pressed={isChatOpen}
        aria-keyshortcuts="Control+Alt+C"
        onClick={onToggleChat}
      >
        Chat
      </button>
    </div>
  );
}

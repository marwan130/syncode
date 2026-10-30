import type { ReactNode } from 'react';
import type { Monaco } from '@monaco-editor/react';
import { RoomHeaderToolbar } from './RoomHeaderToolbar';
import { RoomHeaderActions } from './RoomHeaderActions';
import type { RoomHeaderToolbarProps } from './RoomHeaderToolbar';
import type {
  RoomHeaderProfileProps,
  RoomParticipantManagementProps,
} from './roomHeaderTypes';
import { SyncodeLogo } from '../shared/SyncodeLogo';

export interface RoomHeaderProps {
  profile: RoomHeaderProfileProps;
  participants: RoomParticipantManagementProps;
  toolbar: RoomHeaderToolbarProps & { monaco: Monaco | null };
  notice?: ReactNode;
}

export function RoomHeader({
  profile,
  participants,
  toolbar,
  notice,
}: RoomHeaderProps) {
  return (
    <header className="room-header">
      <RoomHeaderLeft />
      {notice && <div className="room-header-notice-container">{notice}</div>}
      <div className="room-header-right">
        <RoomHeaderToolbar {...toolbar} />
        <RoomHeaderActions {...profile} {...participants} />
      </div>
    </header>
  );
}

function RoomHeaderLeft() {
  return (
    <div className="room-header-left">
      <span className="syncode-brand" aria-label="Syncode">
        <SyncodeLogo className="syncode-brand-logo" />
      </span>
    </div>
  );
}

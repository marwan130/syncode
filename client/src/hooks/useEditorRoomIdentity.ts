import { useCallback, useState } from 'react';
import {
  getOrCreateParticipantId,
  getStoredColor,
  getStoredDisplayName,
} from '../utils/userStorage';

interface RoomProfile {
  roomId: string;
  displayName: string;
}

export function useEditorRoomIdentity(roomId: string) {
  const [profile, setProfile] = useState<RoomProfile>(() => ({
    roomId,
    displayName: getStoredDisplayName(roomId) ?? '',
  }));
  const displayName =
    profile.roomId === roomId
      ? profile.displayName
      : (getStoredDisplayName(roomId) ?? '');
  const [participantId] = useState(() => getOrCreateParticipantId(roomId));
  const [localColor, setLocalColor] = useState(() =>
    getStoredColor(participantId)
  );
  const updateProfile = useCallback(
    (nextProfile: { displayName: string; color: string }) => {
      setProfile({ roomId, displayName: nextProfile.displayName });
      setLocalColor(nextProfile.color);
    },
    [roomId]
  );

  return {
    displayName,
    localColor,
    participantId,
    setLocalColor,
    updateProfile,
  };
}

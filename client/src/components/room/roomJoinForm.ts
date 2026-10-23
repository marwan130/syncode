import { validateRoomInvite, type RoomInvite } from '../../utils/roomInvites';

export type RoomJoinMode = 'profile' | 'create' | 'join';

export type RoomJoinValidation =
  | { valid: true; displayName: string; invite?: RoomInvite }
  | {
      valid: false;
      reason:
        'missing-name' | 'missing-invite' | 'invalid-invite' | 'same-room';
    };

export function validateRoomJoinForm(input: {
  mode: RoomJoinMode;
  name: string;
  lockedName: string;
  inviteLink: string;
  currentRoomId?: string;
  baseUrl?: string;
}): RoomJoinValidation {
  const displayName = (input.lockedName || input.name).trim();
  if (!displayName) return { valid: false, reason: 'missing-name' };
  if (input.mode !== 'join') return { valid: true, displayName };

  const inviteValidation = validateRoomInvite(
    input.inviteLink,
    input.currentRoomId,
    input.baseUrl
  );
  if (inviteValidation.valid)
    return { valid: true, displayName, invite: inviteValidation.invite };
  if (inviteValidation.reason === 'missing')
    return { valid: false, reason: 'missing-invite' };
  if (inviteValidation.reason === 'same-room')
    return { valid: false, reason: 'same-room' };
  return { valid: false, reason: 'invalid-invite' };
}

export function getRoomJoinValidationMessage(
  reason: Exclude<RoomJoinValidation, { valid: true }>['reason']
) {
  if (reason === 'missing-name') return 'Enter a name to continue.';
  if (reason === 'missing-invite') return 'Paste a room invite link.';
  if (reason === 'same-room') return 'You are already in this room.';
  return 'Use a complete room invite link.';
}

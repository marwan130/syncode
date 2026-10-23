import { describe, expect, it } from 'vitest';
import {
  getRoomJoinValidationMessage,
  validateRoomJoinForm,
} from '../roomJoinForm';

const baseUrl = 'https://syncode.example';
const inviteKey = 'a'.repeat(43);

describe('room join form validation', () => {
  it('requires a display name for each form mode', () => {
    expect(
      validateRoomJoinForm({
        mode: 'create',
        name: ' ',
        lockedName: '',
        inviteLink: '',
      })
    ).toEqual({ valid: false, reason: 'missing-name' });
  });

  it('prefers a locked room name and normalizes its surrounding whitespace', () => {
    expect(
      validateRoomJoinForm({
        mode: 'profile',
        name: 'Changed name',
        lockedName: ' Existing name ',
        inviteLink: '',
      })
    ).toEqual({ valid: true, displayName: 'Existing name' });
  });

  it('requires and validates a room invite only in join mode', () => {
    expect(
      validateRoomJoinForm({
        mode: 'join',
        name: 'Miro',
        lockedName: '',
        inviteLink: '',
        baseUrl,
      })
    ).toEqual({ valid: false, reason: 'missing-invite' });
    expect(
      validateRoomJoinForm({
        mode: 'join',
        name: 'Miro',
        lockedName: '',
        inviteLink: `/room/room_42#key=${inviteKey}`,
        currentRoomId: 'room_42',
        baseUrl,
      })
    ).toEqual({ valid: false, reason: 'same-room' });
  });

  it('returns the parsed invite for a valid join', () => {
    expect(
      validateRoomJoinForm({
        mode: 'join',
        name: 'Miro',
        lockedName: '',
        inviteLink: `/room/room_42#key=${inviteKey}`,
        baseUrl,
      })
    ).toEqual({
      valid: true,
      displayName: 'Miro',
      invite: { roomId: 'room_42', accessKey: inviteKey },
    });
  });

  it('maps validation failures to safe user-facing prompts', () => {
    expect(getRoomJoinValidationMessage('missing-name')).toBe(
      'Enter a name to continue.'
    );
    expect(getRoomJoinValidationMessage('invalid-invite')).toBe(
      'Use a complete room invite link.'
    );
  });
});

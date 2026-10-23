import { describe, expect, it } from 'vitest';
import {
  getRoomIdFromInvite,
  isValidRoomAccessKey,
  parseRoomInvite,
  validateRoomInvite,
} from '../roomInvites';

const accessKey = 'A'.repeat(43);
const legacyAccessKey = 'a'.repeat(64);
const baseUrl = 'https://syncode.example';

describe('room invite parsing', () => {
  it('accepts current and legacy access key formats', () => {
    expect(isValidRoomAccessKey(accessKey)).toBe(true);
    expect(isValidRoomAccessKey(legacyAccessKey)).toBe(true);
    expect(isValidRoomAccessKey('invalid')).toBe(false);
  });

  it('parses relative and absolute room links with access keys', () => {
    expect(parseRoomInvite(`/room/room_42#key=${accessKey}`, baseUrl)).toEqual({
      roomId: 'room_42',
      accessKey,
    });
    expect(
      parseRoomInvite(
        `https://syncode.example/room/room_42#key=${legacyAccessKey}`,
        baseUrl
      )
    ).toEqual({ roomId: 'room_42', accessKey: legacyAccessKey });
  });

  it('accepts a room identifier without an access key for room lookup', () => {
    expect(getRoomIdFromInvite('room_42', baseUrl)).toBe('room_42');
    expect(getRoomIdFromInvite('/room/room_42', baseUrl)).toBe('room_42');
  });

  it('reports missing, malformed, and current-room invites explicitly', () => {
    expect(validateRoomInvite('')).toEqual({ valid: false, reason: 'missing' });
    expect(validateRoomInvite('/room/room_42', undefined, baseUrl)).toEqual({
      valid: false,
      reason: 'invalid',
    });
    expect(
      validateRoomInvite(`/room/room_42#key=${accessKey}`, 'room_42', baseUrl)
    ).toEqual({
      valid: false,
      reason: 'same-room',
    });
  });

  it.each([
    '',
    '/room/room_42',
    `/room/room_42#key=${'x'.repeat(42)}!`,
    '/room/bad.id#key=' + accessKey,
    '/not-a-room/room_42#key=' + accessKey,
  ])('rejects malformed invite %j', (invite) => {
    expect(parseRoomInvite(invite, baseUrl)).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearStoredRoomInvite,
  CURSOR_COLORS,
  getStoredColor,
  getStoredRoomInvite,
  setStoredColor,
  storeRoomInvite,
} from '../userStorage';

function createStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('participant color storage', () => {
  it('returns a valid color scoped to the participant', () => {
    vi.stubGlobal(
      'localStorage',
      createStorage({ 'syncode_user_color:participant-1': '#22d3ee' })
    );

    expect(getStoredColor('participant-1')).toBe('#22d3ee');
  });

  it('migrates a valid legacy color into the participant scope', () => {
    const storage = createStorage({ syncode_user_color: '#a78bfa' });
    vi.stubGlobal('localStorage', storage);

    expect(getStoredColor('participant-2')).toBe('#a78bfa');
    expect(storage.getItem('syncode_user_color:participant-2')).toBe('#a78bfa');
  });

  it('replaces invalid persisted values with a valid stored color', () => {
    const storage = createStorage({
      'syncode_user_color:participant-3': 'red',
    });
    vi.stubGlobal('localStorage', storage);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(getStoredColor('participant-3')).toBe(CURSOR_COLORS[0]);
    expect(storage.getItem('syncode_user_color:participant-3')).toBe(
      CURSOR_COLORS[0]
    );
  });

  it('writes explicitly selected colors to the participant scope', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);

    setStoredColor('#4ade80', 'participant-4');

    expect(storage.getItem('syncode_user_color:participant-4')).toBe('#4ade80');
  });
});

describe('last room invite storage', () => {
  it('stores and restores a valid room invite', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    const invite = { roomId: 'room_42', accessKey: 'A'.repeat(43) };

    storeRoomInvite(invite.roomId, invite.accessKey);

    expect(getStoredRoomInvite()).toEqual(invite);
  });

  it('clears only the matching room invite', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    storeRoomInvite('room_42', 'A'.repeat(43));

    clearStoredRoomInvite('another-room');
    expect(getStoredRoomInvite()?.roomId).toBe('room_42');

    clearStoredRoomInvite('room_42');
    expect(getStoredRoomInvite()).toBeNull();
  });

  it('ignores malformed stored invites', () => {
    const storage = createStorage({
      syncode_last_room_invite: JSON.stringify({
        roomId: 'room_42',
        accessKey: 'invalid',
      }),
    });
    vi.stubGlobal('localStorage', storage);

    expect(getStoredRoomInvite()).toBeNull();
    expect(storage.getItem('syncode_last_room_invite')).toBeNull();
  });
});

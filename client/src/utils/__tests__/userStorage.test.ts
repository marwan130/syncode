import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURSOR_COLORS, getStoredColor, setStoredColor } from '../userStorage';

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

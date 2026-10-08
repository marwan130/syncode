import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEYS = {
  DISPLAY_NAME: 'syncode_display_name',
  USER_COLOR: 'syncode_user_color',
} as const;

export const CURSOR_COLORS = [
  '#f97316',
  '#22d3ee',
  '#a78bfa',
  '#4ade80',
  '#f472b6',
  '#facc15',
  '#60a5fa',
  '#fb7185',
];

export function getRandomColor(): string {
  const index = Math.floor(Math.random() * CURSOR_COLORS.length);
  return CURSOR_COLORS[index];
}

export function getStoredDisplayName(roomId: string): string | null {
  try {
    return sessionStorage.getItem(`${STORAGE_KEYS.DISPLAY_NAME}:${roomId}`);
  } catch {
    return null;
  }
}

export function setStoredDisplayName(roomId: string, name: string): boolean {
  try {
    const key = `${STORAGE_KEYS.DISPLAY_NAME}:${roomId}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, name.trim());
    return true;
  } catch (err) {
    void err;
    return false;
  }
}

export function getStoredColor(): string {
  try {
    const color = localStorage.getItem(STORAGE_KEYS.USER_COLOR);
    if (color && CURSOR_COLORS.includes(color)) {
      return color;
    }
  } catch (err) {
    void err;
  }
  const fallback = getRandomColor();
  setStoredColor(fallback);
  return fallback;
}

export function setStoredColor(color: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.USER_COLOR, color);
  } catch (err) {
    void err;
  }
}

export function createSiteId(): string {
  // A CRDT site ID must be unique per editor tab. sessionStorage can be copied
  // when a tab is duplicated, causing two editors to generate colliding IDs.
  return uuidv4();
}

import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEYS = {
  DISPLAY_NAME: 'syncode_display_name',
  USER_COLOR: 'syncode_user_color',
  SITE_ID: 'syncode_site_id',
} as const;

export const CURSOR_COLORS = [
  '#f97316', // orange
  '#22d3ee', // cyan
  '#a78bfa', // violet
  '#4ade80', // green
  '#f472b6', // pink
  '#facc15', // yellow
  '#60a5fa', // blue
  '#fb7185', // rose
];

export function getRandomColor(): string {
  const index = Math.floor(Math.random() * CURSOR_COLORS.length);
  return CURSOR_COLORS[index];
}

export function getStoredDisplayName(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.DISPLAY_NAME);
  } catch {
    return null;
  }
}

export function setStoredDisplayName(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, name.trim());
  } catch (err) {
    void err;
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

export function getOrCreateSiteId(): string {
  try {
    localStorage.removeItem(STORAGE_KEYS.SITE_ID);

    const existing = sessionStorage.getItem(STORAGE_KEYS.SITE_ID);
    if (existing) return existing;

    const newId = uuidv4();
    sessionStorage.setItem(STORAGE_KEYS.SITE_ID, newId);
    return newId;
  } catch {
    return uuidv4();
  }
}

import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEYS = {
  DISPLAY_NAME: 'syncode_display_name',
  USER_COLOR: 'syncode_user_color',
} as const;

const participantKey = (roomId: string) => `syncode_participant_id:${roomId}`;

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

function getRandomColor(): string {
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
  } catch {
    return false;
  }
}

export function getStoredColor(participantId?: string): string {
  try {
    const scopedKey = participantId
      ? `${STORAGE_KEYS.USER_COLOR}:${participantId}`
      : STORAGE_KEYS.USER_COLOR;
    const scopedColor = localStorage.getItem(scopedKey);
    if (scopedColor && CURSOR_COLORS.includes(scopedColor)) return scopedColor;

    const color = participantId
      ? localStorage.getItem(STORAGE_KEYS.USER_COLOR)
      : scopedColor;
    if (color && CURSOR_COLORS.includes(color)) {
      if (participantId) localStorage.setItem(scopedKey, color);
      return color;
    }
  } catch {
    // Use an in-memory color if browser storage is unavailable.
  }
  const fallback = getRandomColor();
  setStoredColor(fallback, participantId);
  return fallback;
}

export function setStoredColor(color: string, participantId?: string): void {
  try {
    const key = participantId
      ? `${STORAGE_KEYS.USER_COLOR}:${participantId}`
      : STORAGE_KEYS.USER_COLOR;
    localStorage.setItem(key, color);
  } catch {
    // The current avatar color remains available for this session.
  }
}

export function createSiteId(): string {
  // A CRDT site ID must be unique per editor tab. sessionStorage can be copied
  // when a tab is duplicated, causing two editors to generate colliding IDs.
  return uuidv4();
}

export function getOrCreateParticipantId(roomId: string): string {
  try {
    const key = participantKey(roomId);
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = uuidv4();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return uuidv4();
  }
}

export function setParticipantId(roomId: string, id: string): void {
  try {
    sessionStorage.setItem(participantKey(roomId), id);
  } catch {
    // A new participant ID is generated on the next room entry.
  }
}

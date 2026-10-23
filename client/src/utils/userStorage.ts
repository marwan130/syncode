import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEYS = {
  DISPLAY_NAME: 'syncode_display_name',
  USER_COLOR: 'syncode_user_color',
} as const;

const participantKey = (roomId: string) => `syncode_participant_id:${roomId}`;
const roomCreatorTokenKey = (roomId: string) =>
  `syncode_room_creator_token:${roomId}`;

export function getStoredRoomCreatorToken(roomId: string): string | null {
  try {
    return sessionStorage.getItem(roomCreatorTokenKey(roomId));
  } catch {
    return null;
  }
}

export function setStoredRoomCreatorToken(roomId: string, token: string): void {
  try {
    sessionStorage.setItem(roomCreatorTokenKey(roomId), token);
  } catch {
    return;
  }
}

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

function readValidColor(key: string): string | null {
  const color = localStorage.getItem(key);
  return color && CURSOR_COLORS.includes(color) ? color : null;
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
  const fallback = getRandomColor();
  try {
    const scopedKey = getColorStorageKey(participantId);
    const scopedColor = readValidColor(scopedKey);
    if (scopedColor) return scopedColor;
    if (participantId) {
      const legacyColor = readValidColor(STORAGE_KEYS.USER_COLOR);
      if (legacyColor) {
        localStorage.setItem(scopedKey, legacyColor);
        return legacyColor;
      }
    }
  } catch {
    return fallback;
  }
  setStoredColor(fallback, participantId);
  return fallback;
}

export function setStoredColor(color: string, participantId?: string): void {
  try {
    localStorage.setItem(getColorStorageKey(participantId), color);
  } catch {
    return;
  }
}

function getColorStorageKey(participantId?: string) {
  return participantId
    ? `${STORAGE_KEYS.USER_COLOR}:${participantId}`
    : STORAGE_KEYS.USER_COLOR;
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
    return;
  }
}

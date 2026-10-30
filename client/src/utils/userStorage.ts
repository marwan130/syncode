import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEYS = {
  DISPLAY_NAME: 'syncode_display_name',
  USER_COLOR: 'syncode_user_color',
} as const;

const participantKey = (roomId: string) => `syncode_participant_id:${roomId}`;
const joinRequestKey = (roomId: string) => `syncode_join_request_id:${roomId}`;
const joinRejectedKey = (roomId: string) => `syncode_join_rejected:${roomId}`;
const roomCreatorTokenKey = (roomId: string) =>
  `syncode_room_creator_token:${roomId}`;

export function getStoredRoomCreatorToken(roomId: string): string | null {
  try {
    const key = roomCreatorTokenKey(roomId);
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setStoredRoomCreatorToken(roomId: string, token: string): void {
  try {
    const key = roomCreatorTokenKey(roomId);
    localStorage.setItem(key, token);
    sessionStorage.setItem(key, token);
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
    const key = `${STORAGE_KEYS.DISPLAY_NAME}:${roomId}`;
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStoredDisplayName(roomId: string, name: string): boolean {
  try {
    const key = `${STORAGE_KEYS.DISPLAY_NAME}:${roomId}`;
    if (localStorage.getItem(key) || sessionStorage.getItem(key)) return false;
    const trimmed = name.trim();
    localStorage.setItem(key, trimmed);
    sessionStorage.setItem(key, trimmed);
    return true;
  } catch {
    return false;
  }
}

export function storeRoomProfile(
  roomId: string,
  displayName: string,
  color: string,
  participantId = getOrCreateParticipantId(roomId)
): string {
  const savedName = getStoredDisplayName(roomId) ?? displayName;
  setStoredDisplayName(roomId, savedName);
  setStoredColor(color, participantId);
  return savedName;
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
    const existing = localStorage.getItem(key) ?? sessionStorage.getItem(key);
    if (existing) {
      localStorage.setItem(key, existing);
      sessionStorage.setItem(key, existing);
      return existing;
    }
    const id = uuidv4();
    localStorage.setItem(key, id);
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return uuidv4();
  }
}

export function getOrCreateJoinRequestId(roomId: string): string {
  try {
    const key = joinRequestKey(roomId);
    const existing = localStorage.getItem(key) ?? sessionStorage.getItem(key);
    if (existing) {
      localStorage.setItem(key, existing);
      sessionStorage.setItem(key, existing);
      return existing;
    }
    const id = uuidv4().replaceAll('-', '');
    localStorage.setItem(key, id);
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return uuidv4().replaceAll('-', '');
  }
}

export function renewJoinRequestId(roomId: string): string {
  const id = uuidv4().replaceAll('-', '');
  try {
    const key = joinRequestKey(roomId);
    const rejectedKey = joinRejectedKey(roomId);
    localStorage.setItem(key, id);
    sessionStorage.setItem(key, id);
    localStorage.removeItem(rejectedKey);
    sessionStorage.removeItem(rejectedKey);
  } catch {
    return id;
  }
  return id;
}

export function isJoinRequestRejected(roomId: string): boolean {
  try {
    const key = joinRejectedKey(roomId);
    return (
      localStorage.getItem(key) === '1' || sessionStorage.getItem(key) === '1'
    );
  } catch {
    return false;
  }
}

export function markJoinRequestRejected(roomId: string): void {
  try {
    const key = joinRejectedKey(roomId);
    localStorage.setItem(key, '1');
    sessionStorage.setItem(key, '1');
  } catch {
    return;
  }
}

export function clearStoredRoomProfile(roomId: string): void {
  try {
    const pKey = participantKey(roomId);
    const jKey = joinRequestKey(roomId);
    const rKey = joinRejectedKey(roomId);
    const cKey = roomCreatorTokenKey(roomId);
    const nameKey = `${STORAGE_KEYS.DISPLAY_NAME}:${roomId}`;
    const participantId =
      localStorage.getItem(pKey) ?? sessionStorage.getItem(pKey);

    sessionStorage.removeItem(pKey);
    sessionStorage.removeItem(jKey);
    sessionStorage.removeItem(rKey);
    sessionStorage.removeItem(cKey);
    sessionStorage.removeItem(nameKey);

    localStorage.removeItem(pKey);
    localStorage.removeItem(jKey);
    localStorage.removeItem(rKey);
    localStorage.removeItem(cKey);
    localStorage.removeItem(nameKey);

    if (participantId)
      localStorage.removeItem(getColorStorageKey(participantId));
  } catch {
    return;
  }
}

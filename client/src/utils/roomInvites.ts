const LEGACY_ACCESS_KEY_PATTERN = /^[0-9a-f]{64}$/i;
const ACCESS_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidRoomAccessKey(accessKey: string): boolean {
  return (
    LEGACY_ACCESS_KEY_PATTERN.test(accessKey) ||
    ACCESS_KEY_PATTERN.test(accessKey)
  );
}

export interface RoomInvite {
  roomId: string;
  accessKey: string;
}

export type RoomInviteValidation =
  | { valid: true; invite: RoomInvite }
  | { valid: false; reason: 'missing' | 'invalid' | 'same-room' };

export function validateRoomInvite(
  value: string,
  currentRoomId?: string,
  baseUrl?: string
): RoomInviteValidation {
  if (!value.trim()) return { valid: false, reason: 'missing' };
  const invite = baseUrl
    ? parseRoomInvite(value, baseUrl)
    : parseRoomInvite(value);
  if (!invite) return { valid: false, reason: 'invalid' };
  if (invite.roomId === currentRoomId)
    return { valid: false, reason: 'same-room' };
  return { valid: true, invite };
}

function getInviteUrl(value: string, baseUrl: string): URL | null {
  const invite = value.trim();
  if (!invite) return null;
  try {
    return new URL(
      invite.startsWith('/') || /^https?:\/\//i.test(invite)
        ? invite
        : `/room/${invite}`,
      baseUrl
    );
  } catch {
    return null;
  }
}

export function getRoomIdFromInvite(
  value: string,
  baseUrl = window.location.origin
): string | null {
  const inviteUrl = getInviteUrl(value, baseUrl);
  return inviteUrl?.pathname.match(/\/room\/([a-zA-Z0-9_-]+)\/?$/)?.[1] ?? null;
}

export function parseRoomInvite(
  value: string,
  baseUrl = window.location.origin
): RoomInvite | null {
  const inviteUrl = getInviteUrl(value, baseUrl);
  const roomId = inviteUrl?.pathname.match(/\/room\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
  const accessKey =
    inviteUrl && new URLSearchParams(inviteUrl.hash.slice(1)).get('key');

  if (!roomId || !accessKey || !isValidRoomAccessKey(accessKey)) return null;
  return { roomId, accessKey };
}

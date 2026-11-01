import { setStoredRoomCreatorToken, storeRoomProfile } from './userStorage';

export async function createRoomSession(
  displayName: string,
  color: string
): Promise<string> {
  const response = await fetch('/api/rooms', { method: 'POST' });
  if (!response.ok) throw new Error('Room creation failed.');

  const room: unknown = await response.json();
  if (!isRoomInvite(room)) throw new Error('The room invite was incomplete.');

  storeRoomProfile(room.roomId, displayName, color);
  setStoredRoomCreatorToken(room.roomId, room.creatorToken);
  return `/room/${room.roomId}#key=${room.accessKey}`;
}

function isRoomInvite(
  room: unknown
): room is { roomId: string; accessKey: string; creatorToken: string } {
  return (
    isRecord(room) &&
    ['roomId', 'accessKey', 'creatorToken'].every(
      (key) => typeof room[key] === 'string' && room[key].length > 0
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

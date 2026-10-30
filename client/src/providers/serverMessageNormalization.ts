import type { ChatMessage, ParticipantInfo } from './SignalRCrdtProvider';

export function normalizeParticipant(
  raw: Record<string, unknown>
): ParticipantInfo {
  return {
    connectionId: readString(raw, 'connectionId', 'ConnectionId', ''),
    memberId: readOptionalString(raw, 'memberId', 'MemberId'),
    displayName: readString(raw, 'displayName', 'DisplayName', 'Anonymous'),
    color: readString(raw, 'color', 'Color', '#38bdf8'),
    avatarUrl: readOptionalString(raw, 'avatarUrl', 'AvatarUrl'),
    isAdmin: Boolean(readValue(raw, 'isAdmin', 'IsAdmin', false)),
    isLocked: Boolean(readValue(raw, 'isLocked', 'IsLocked', false)),
  };
}

function readOptionalString(
  raw: Record<string, unknown>,
  camelName: string,
  pascalName: string
): string | undefined {
  const value = readValue(raw, camelName, pascalName, undefined);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function normalizeChatMessage(
  raw: Record<string, unknown>
): ChatMessage {
  return {
    id: readString(raw, 'id', 'Id', ''),
    author: readString(raw, 'author', 'Author', 'Anonymous'),
    color: readString(raw, 'color', 'Color', '#38bdf8'),
    content: readString(raw, 'content', 'Content', ''),
    sentAt: readString(raw, 'sentAt', 'SentAt', new Date().toISOString()),
  };
}

function readString(
  raw: Record<string, unknown>,
  camelName: string,
  pascalName: string,
  fallback: string
) {
  return String(readValue(raw, camelName, pascalName, fallback));
}

function readValue(
  raw: Record<string, unknown>,
  camelName: string,
  pascalName: string,
  fallback: unknown
) {
  return raw[camelName] ?? raw[pascalName] ?? fallback;
}

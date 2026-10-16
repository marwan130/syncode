const LEGACY_ACCESS_KEY_PATTERN = /^[0-9a-f]{64}$/i;
const ACCESS_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidRoomAccessKey(accessKey: string): boolean {
  return LEGACY_ACCESS_KEY_PATTERN.test(accessKey) || ACCESS_KEY_PATTERN.test(accessKey);
}

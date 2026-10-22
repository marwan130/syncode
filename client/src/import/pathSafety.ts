const INVALID_SEGMENT_CHARACTERS = /[\\/:*?"<>|]/;

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function normalizeImportPath(path: string): string {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > 512 ||
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[a-zA-Z]:/.test(path)
  ) {
    throw new Error('The folder contains an unsafe file path.');
  }

  const segments = path.split('/');
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.length > 128 ||
        INVALID_SEGMENT_CHARACTERS.test(segment) ||
        containsControlCharacter(segment)
    )
  ) {
    throw new Error('The folder contains an unsafe file path.');
  }

  return segments.join('/');
}

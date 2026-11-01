import { describe, expect, it } from 'vitest';
import { formatCommitAge } from '../commitAge';

const now = Date.UTC(2026, 0, 1);

describe('formatCommitAge', () => {
  it.each([
    [null, 'Date unknown'],
    [new Date(now - 59_999).toISOString(), 'just now'],
    [new Date(now - 60_000).toISOString(), '1 minute ago'],
    [new Date(now - 60 * 60_000).toISOString(), '1 hour ago'],
    [new Date(now - 24 * 60 * 60_000).toISOString(), '1 day ago'],
    [new Date(now - 30 * 24 * 60 * 60_000).toISOString(), '1 month ago'],
    [new Date(now - 365 * 24 * 60 * 60_000).toISOString(), '1 year ago'],
    [new Date(now + 60_000).toISOString(), 'just now'],
  ])('formats %s as %s', (date, expected) => {
    expect(formatCommitAge(date, now)).toBe(expected);
  });
});

import { describe, expect, it } from 'vitest';
import { userFacingError } from '../userFacingError';

describe('userFacingError', () => {
  it('uses a safe message for known server errors', () => {
    expect(
      userFacingError(
        new Error('Invalid or expired room invitation.'),
        'Try again.'
      )
    ).toBe('That room invite is invalid or has expired.');
  });

  it('formats known rate limit delays without exposing raw errors', () => {
    expect(
      userFacingError(
        new Error('Execution rate limit reached. Try again in 12 seconds.'),
        'Try again.'
      )
    ).toBe('Code is being run too quickly. Try again in 12 seconds.');
  });

  it('uses a safe fallback for unknown server errors', () => {
    expect(
      userFacingError(
        new Error('database password leaked'),
        'Please try again.'
      )
    ).toBe('Please try again.');
    expect(userFacingError('internal exception', 'Please retry.')).toBe(
      'Please retry.'
    );
  });

  it('does not reveal malformed JSON details', () => {
    expect(userFacingError(new SyntaxError('secret input'), 'Try again.')).toBe(
      'The selected file is not valid JSON.'
    );
  });
});

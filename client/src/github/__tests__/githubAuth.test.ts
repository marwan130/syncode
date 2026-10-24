import { describe, expect, it } from 'vitest';
import { getTrustedGithubAuthorizationUrl } from '../githubAuth';

describe('GitHub authorization navigation', () => {
  it('accepts only the fixed HTTPS GitHub authorization endpoint', () => {
    const target = new URL(
      'https://github.com/login/oauth/authorize?client_id=syncode'
    );

    expect(getTrustedGithubAuthorizationUrl(target)).toBe(target.href);
  });

  it.each([
    'http://github.com/login/oauth/authorize',
    'https://github.com.attacker.example/login/oauth/authorize',
    'https://github.com/login/oauth/access_token',
    'javascript:alert(1)',
  ])('rejects an untrusted authorization destination %s', (value) => {
    expect(() => getTrustedGithubAuthorizationUrl(new URL(value))).toThrow(
      'GitHub sign-in could not be started.'
    );
  });
});

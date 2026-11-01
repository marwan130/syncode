import { afterEach, describe, expect, it, vi } from 'vitest';
import { listGithubBranches } from '../repositoryBrowser';

describe('GitHub repository requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps user supplied repository fields in an encoded same-origin API URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await listGithubBranches('//attacker.example/path', 'repo?name=other');

    const [requestUrl, requestOptions] = fetchMock.mock.calls[0];
    const parsedUrl = new URL(String(requestUrl), 'https://syncode.invalid');
    expect(parsedUrl.origin).toBe('https://syncode.invalid');
    expect(parsedUrl.pathname).toBe('/api/github/repository/branches');
    expect(parsedUrl.searchParams.get('owner')).toBe('//attacker.example/path');
    expect(parsedUrl.searchParams.get('name')).toBe('repo?name=other');
    expect(requestOptions).toMatchObject({
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
    });
  });
});

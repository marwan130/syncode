import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  baselineForSelectedFiles,
  parseGithubRepositoryInput,
  reviewGithubRepository,
} from '../repoImport';
import type { GithubRepositoryImportResponse } from '../githubTypes';

describe('parseGithubRepositoryInput', () => {
  it('accepts repository and branch URLs from github.com', () => {
    expect(parseGithubRepositoryInput('https://github.com/owner/repo')).toEqual(
      {
        owner: 'owner',
        name: 'repo',
      }
    );
    expect(
      parseGithubRepositoryInput('https://github.com/owner/repo/tree/main/src')
    ).toEqual({ owner: 'owner', name: 'repo', branch: 'main/src' });
  });

  it.each([
    'https://github.com.evil.test/owner/repo',
    'https://user@github.com/owner/repo',
    'http://github.com/owner/repo',
    'https://github.com/owner/repo?redirect=evil.test',
    'owner/../repo',
  ])('rejects unsafe repository input %s', (value) => {
    expect(() => parseGithubRepositoryInput(value)).toThrow();
  });
});

const repository = { owner: 'owner', name: 'repo' };
const importResult: GithubRepositoryImportResponse = {
  baseline: {
    owner: 'owner',
    name: 'repo',
    branch: 'main',
    baseCommitSha: 'commit',
    baseTreeSha: 'tree',
    isPrivate: false,
    fileBlobShas: { 'index.js': 'blob' },
  },
  files: [{ path: 'index.js', content: '', blobSha: 'blob', size: 0 }],
  skipped: [],
};

describe('reviewGithubRepository', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('validates repository previews and preserves the admin grant request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(importResult));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      reviewGithubRepository(repository, 'room', 'access', 'grant')
    ).resolves.toEqual(importResult);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/github/repository/import',
      expect.objectContaining({
        credentials: 'include',
        redirect: 'error',
        body: JSON.stringify({
          roomId: 'room',
          accessKey: 'access',
          ...repository,
        }),
      })
    );
  });

  it.each([
    [
      'scope_required',
      400,
      'Authorize access to this repository, then try again.',
    ],
    [
      'rate_limited',
      429,
      'GitHub is limiting repository requests. Try again later.',
    ],
    [
      'repository_unavailable',
      404,
      'The repository could not be found or accessed.',
    ],
    ['import_too_large', 413, 'This repository is too large to import.'],
    [
      'unauthorized',
      401,
      'Your GitHub session expired. Sign in again and retry.',
    ],
    [
      'reauthorize',
      401,
      'Your GitHub session expired. Sign in again and retry.',
    ],
    ['unknown', 403, 'Authorize access to this repository, then try again.'],
    ['unknown', 500, 'Could not read this GitHub repository.'],
  ])('maps safe error %s', async (error, status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error }, { status }))
    );

    await expect(
      reviewGithubRepository(repository, 'room', 'access', 'grant')
    ).rejects.toThrow(message);
  });

  it('uses a generic error when an error response is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('private response details')),
      })
    );

    await expect(
      reviewGithubRepository(repository, 'room', 'access', 'grant')
    ).rejects.toThrow('Could not read this GitHub repository.');
  });

  it.each([
    null,
    'invalid',
    {},
    { baseline: {}, files: 'invalid', skipped: [] },
    { baseline: {}, files: [], skipped: 'invalid' },
    { baseline: { fileBlobShas: null }, files: [], skipped: [] },
    { baseline: { fileBlobShas: {} }, files: [{}], skipped: [] },
  ])('rejects invalid repository preview payloads', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)));

    await expect(
      reviewGithubRepository(repository, 'room', 'access', 'grant')
    ).rejects.toThrow('GitHub returned an invalid repository preview.');
  });
});

describe('baselineForSelectedFiles', () => {
  it('keeps only the blob hashes for selected paths', () => {
    const baseline = {
      ...importResult.baseline,
      fileBlobShas: { 'index.js': 'blob', 'src/app.ts': 'other' },
    };

    expect(
      baselineForSelectedFiles(baseline, [{ path: 'src/app.ts' }])
    ).toEqual({
      ...baseline,
      fileBlobShas: { 'src/app.ts': 'other' },
    });
  });
});

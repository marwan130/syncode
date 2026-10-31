import type {
  GithubRepositoryImportResponse,
  GithubRepositoryBaseline,
} from './githubTypes';

export interface ParsedGithubRepository {
  owner: string;
  name: string;
  branch?: string;
}

export function parseGithubRepositoryInput(
  value: string
): ParsedGithubRepository {
  const trimmed = value.trim();
  let parts: string[];
  if (trimmed.includes('://')) {
    const url = new URL(trimmed);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error('Enter a GitHub repository URL.');
    }
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } else {
    parts = trimmed.split('/').filter(Boolean);
  }

  if (parts.length < 2) throw new Error('Enter a GitHub repository URL.');
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/i, '');
  let branch: string | undefined;
  if (parts.length > 2) {
    if (parts[2] !== 'tree' || parts.length < 4)
      throw new Error('Use a repository URL or a branch URL from GitHub.');
    branch = parts.slice(3).join('/');
  }

  if (
    !/^[A-Za-z0-9-]{1,39}$/.test(owner) ||
    !/^[A-Za-z0-9._-]{1,100}$/.test(name) ||
    name === '.' ||
    name === '..'
  ) {
    throw new Error('The GitHub repository address is invalid.');
  }
  return { owner, name, ...(branch ? { branch } : {}) };
}

export async function reviewGithubRepository(
  repository: ParsedGithubRepository,
  roomId: string,
  accessKey: string,
  adminGrant: string
): Promise<GithubRepositoryImportResponse> {
  const response = await fetch('/api/github/repository/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Syncode-Admin-Grant': adminGrant,
    },
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
    body: JSON.stringify({ roomId, accessKey, ...repository }),
  });
  if (!response.ok) throw new Error(await getRepositoryError(response));
  const result = (await response.json()) as GithubRepositoryImportResponse;
  if (!isRepositoryImport(result))
    throw new Error('GitHub returned an invalid repository preview.');
  return result;
}

export function baselineForSelectedFiles(
  baseline: GithubRepositoryBaseline,
  files: Array<{ path: string }>
): GithubRepositoryBaseline {
  const selected = new Set(files.map((file) => file.path));
  return {
    ...baseline,
    fileBlobShas: Object.fromEntries(
      Object.entries(baseline.fileBlobShas).filter(([path]) =>
        selected.has(path)
      )
    ),
    ...(baseline.fileLineEndings && {
      fileLineEndings: Object.fromEntries(
        Object.entries(baseline.fileLineEndings).filter(([path]) =>
          selected.has(path)
        )
      ),
    }),
  };
}

async function getRepositoryError(response: Response): Promise<string> {
  const result = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  switch (result?.error) {
    case 'scope_required':
      return 'Authorize access to this repository, then try again.';
    case 'rate_limited':
      return 'GitHub is limiting repository requests. Try again later.';
    case 'repository_unavailable':
      return 'The repository could not be found or accessed.';
    case 'import_too_large':
      return 'This repository is too large to import.';
    case 'unauthorized':
    case 'reauthorize':
      return 'Your GitHub session expired. Sign in again and retry.';
    default:
      return response.status === 403
        ? 'Authorize access to this repository, then try again.'
        : 'Could not read this GitHub repository.';
  }
}

function isRepositoryImport(
  value: unknown
): value is GithubRepositoryImportResponse {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<GithubRepositoryImportResponse>;
  return Boolean(
    result.baseline &&
    Array.isArray(result.files) &&
    Array.isArray(result.skipped) &&
    result.baseline.fileBlobShas &&
    Object.keys(result.baseline.fileBlobShas).length === result.files.length
  );
}

import type {
  GithubPushResponse,
  GithubRepositoryCreateRequest,
} from './githubTypes';

export interface GithubRepositoryOption {
  owner: string;
  name: string;
  defaultBranch: string;
  isPrivate: boolean;
  updatedAt: string;
}

export interface GithubBranchOption {
  name: string;
  sha: string;
  isProtected: boolean;
}

export interface GithubCommitHistoryItem {
  sha: string;
  message: string;
  author: string;
  date: string | null;
  parents: string[];
}

export interface GithubCommitDetails {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export async function getGithubFileContent(
  owner: string,
  name: string,
  sha: string
): Promise<string> {
  const query = new URLSearchParams({ owner, name, sha });
  const result = await request<{ content: string }>(
    `/api/github/repository/file?${query}`
  );
  return result.content;
}

export async function listGithubRepositories(): Promise<
  GithubRepositoryOption[]
> {
  return request<GithubRepositoryOption[]>(
    '/api/github/repository/repositories'
  );
}

export async function createGithubRepository(
  createRequest: GithubRepositoryCreateRequest,
  adminGrant: string
): Promise<GithubPushResponse> {
  return request('/api/github/repository/create', {
    method: 'POST',
    body: JSON.stringify(createRequest),
    headers: { 'X-Syncode-Admin-Grant': adminGrant },
  });
}

export async function listGithubBranches(
  owner: string,
  name: string
): Promise<GithubBranchOption[]> {
  const query = new URLSearchParams({ owner, name });
  return request<GithubBranchOption[]>(
    `/api/github/repository/branches?${query}`
  );
}

export async function listGithubHistory(
  owner: string,
  name: string,
  branch: string,
  page = 1
): Promise<GithubCommitHistoryItem[]> {
  const query = new URLSearchParams({ owner, name, branch, page: `${page}` });
  return request<GithubCommitHistoryItem[]>(
    `/api/github/repository/history?${query}`
  );
}

export async function getGithubCommitDetails(
  owner: string,
  name: string,
  sha: string
): Promise<GithubCommitDetails> {
  const query = new URLSearchParams({ owner, name, sha });
  return request<GithubCommitDetails>(`/api/github/repository/commit?${query}`);
}

export async function createGithubBranch(
  owner: string,
  name: string,
  branch: string,
  sourceBranch: string
): Promise<GithubBranchOption> {
  return request<GithubBranchOption>('/api/github/repository/branches', {
    method: 'POST',
    body: JSON.stringify({ owner, name, branch, sourceBranch }),
  });
}

export async function renameGithubBranch(
  owner: string,
  name: string,
  branch: string,
  newName: string
): Promise<void> {
  await request('/api/github/repository/branches/rename', {
    method: 'POST',
    body: JSON.stringify({ owner, name, branch, newName }),
  });
}

export async function deleteGithubBranch(
  owner: string,
  name: string,
  branch: string
): Promise<void> {
  const query = new URLSearchParams({ owner, name, branch });
  await request(`/api/github/repository/branches?${query}`, {
    method: 'DELETE',
  });
}

async function request<T = { success: true }>(
  path: string,
  options: { method?: string; body?: string; headers?: HeadersInit } = {}
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    ...(options.body
      ? {
          headers: {
            'Content-Type': 'application/json',
            ...Object.fromEntries(new Headers(options.headers).entries()),
          },
          body: options.body,
        }
      : {}),
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw await repositoryBrowserError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function repositoryBrowserError(response: Response): Promise<Error> {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  const messages: Record<string, string> = {
    reauthorize: 'Your GitHub session expired. Sign in again and retry.',
    scope_required: 'Authorize GitHub repository access and try again.',
    repository_unavailable: 'The repository could not be found or accessed.',
    branch_moved: 'The branch changed. Refresh the repository and retry.',
    invalid_branch: 'Enter a valid Git branch name.',
    rate_limited: 'GitHub is limiting repository requests. Try again later.',
  };
  return new Error(
    messages[payload?.error ?? ''] ??
      'Could not complete the GitHub repository request.'
  );
}

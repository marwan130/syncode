import type { GithubFileChange, GithubPushResponse } from './githubTypes';

const PUSH_ERRORS: Record<string, string> = {
  scope_required: 'Authorize GitHub repository access before pushing.',
  branch_moved:
    'The GitHub branch moved. Refresh the repository before pushing.',
  rate_limited: 'GitHub is limiting repository requests. Try again later.',
  reauthorize: 'Your GitHub session expired. Sign in again and retry.',
};

export async function pushGithubChanges(
  roomId: string,
  accessKey: string,
  message: string,
  changes: GithubFileChange[]
): Promise<GithubPushResponse> {
  const response = await fetch('/api/github/repository/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
    body: JSON.stringify({ roomId, accessKey, message, changes }),
  });
  if (!response.ok) throw await getPushError(response);
  return (await response.json()) as GithubPushResponse;
}

async function getPushError(response: Response): Promise<Error> {
  const result = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return new Error(
    PUSH_ERRORS[result?.error ?? ''] ??
      'Could not push these changes to GitHub.'
  );
}

import type { GithubChangeStatus } from '../../github/changeTracker';
import type { GithubRepositoryBaseline } from '../../github/githubTypes';

export interface GithubRepositoryExplorerStatusProps {
  baseline?: GithubRepositoryBaseline | null;
  changes?: GithubChangeStatus[];
}

export function GithubRepositoryExplorerStatus({
  baseline,
  changes,
}: GithubRepositoryExplorerStatusProps) {
  if (!baseline) return null;
  const count = changes?.length ?? 0;
  const status = getChangeStatus(count);

  return (
    <div className="github-explorer-status" role="status" aria-live="polite">
      {status}
    </div>
  );
}

function getChangeStatus(count: number): string {
  if (count === 0) return 'GitHub · no changes';
  const unit = count === 1 ? 'change' : 'changes';
  return `GitHub · ${count} ${unit}`;
}

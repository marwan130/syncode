import type { GithubRepositoryExplorerProps } from '../editor/fileExplorerTypes';
import { GithubRepositoryExplorerAction } from './GithubRepositoryExplorerAction';
import { GithubRepositoryExplorerStatus } from './GithubRepositoryExplorerStatus';

export function createGithubRepositoryExplorerControls(
  options: GithubRepositoryExplorerProps
) {
  return {
    action: <GithubRepositoryExplorerAction {...options} />,
    status: (
      <GithubRepositoryExplorerStatus
        baseline={options.baseline}
        changes={options.changes}
      />
    ),
  };
}

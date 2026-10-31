import type { FileExplorerGitStatus } from './fileExplorerUtils';

const CHANGE_LABELS = {
  added: 'U',
  modified: 'M',
  deleted: 'D',
  mixed: '*',
} as const;

export function FileExplorerGitIndicator({
  status,
  isFolder = false,
  hasProblem = false,
}: {
  status?: FileExplorerGitStatus;
  isFolder?: boolean;
  hasProblem?: boolean;
}) {
  if (!status) return null;
  const label = CHANGE_LABELS[status.kind];
  const changeKind = status.kind === 'mixed' ? 'mixed' : status.kind;
  const description = `${changeKind} ${isFolder ? 'folder' : 'file'}${status.changeCount === 1 ? '' : 's'}`;

  return (
    <span
      className={`file-explorer-git-indicator is-${status.kind}${hasProblem ? ' has-problem' : ''}`}
      role="img"
      title={`${description}${hasProblem ? ', contains problems' : ''}`}
      aria-label={`${description}${hasProblem ? ', contains problems' : ''}`}
    >
      {isFolder ? (
        <span className="file-explorer-git-dot" aria-hidden="true" />
      ) : (
        <span aria-hidden="true">{label}</span>
      )}
    </span>
  );
}

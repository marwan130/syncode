import { Icon } from '@iconify/react';
import type { FileExplorerGitStatus } from './fileExplorerUtils';

const CHANGE_LABELS = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  mixed: '*',
} as const;

export function FileExplorerGitIndicator({
  status,
  aggregate = false,
}: {
  status?: FileExplorerGitStatus;
  aggregate?: boolean;
}) {
  if (!status) return null;
  const label = aggregate && status.changeCount > 1
    ? String(status.changeCount)
    : CHANGE_LABELS[status.kind];
  const changeKind = status.kind === 'mixed' ? 'mixed' : status.kind;
  const description = `${status.changeCount} ${changeKind} ${status.changeCount === 1 ? 'change' : 'changes'}, ${status.stagedCount} staged`;

  return (
    <span
      className={`file-explorer-git-indicator is-${status.kind}`}
      role="img"
      title={description}
      aria-label={description}
    >
      <span aria-hidden="true">{label}</span>
      {status.stagedCount > 0 && (
        <Icon
          className="file-explorer-git-staged"
          icon="codicon:check"
          aria-hidden="true"
        />
      )}
    </span>
  );
}

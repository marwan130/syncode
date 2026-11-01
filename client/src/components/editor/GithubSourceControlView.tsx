import { useState } from 'react';
import { Icon } from '@iconify/react';
import type { GithubChangeStatus } from '../../github/changeTracker';
import type { GithubRepositoryExplorerProps } from './fileExplorerTypes';
import { getFileIcon } from './fileExplorerUtils';
import { GithubSourceControlRemoteActions } from './GithubSourceControlRemoteActions';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';
import { useGithubAuth } from '../../github/useGithubAuth';
import { pushGithubChanges } from '../../github/commitPush';
import { userFacingError } from '../../utils/userFacingError';
import { SourceControlPanel } from './SourceControlPanel';
import { FileExplorerGitIndicator } from './FileExplorerGitIndicator';
import { useAppActivity } from '../shared/useAppActivity';

export interface GithubSourceControlViewProps {
  github?: GithubRepositoryExplorerProps;
  canManageRepositories: boolean;
  onOpenGithub: (repositoryUrl?: string) => void;
  onOpenChange: (change: GithubChangeStatus) => void;
}

export function GithubSourceControlView({
  github,
  canManageRepositories,
  onOpenGithub,
  onOpenChange,
}: GithubSourceControlViewProps) {
  const { account } = useGithubAuth();
  const { runActivity } = useAppActivity();
  const [targetBranch, setTargetBranch] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [pushMessage, setPushMessage] = useState('');
  const [isPushing, setPushing] = useState(false);
  const [reviewPaths, setReviewPaths] = useState<Set<string>>(() => new Set());
  const baseline = github?.baseline;
  const changes = github?.changes ?? [];
  const selectedForReview = changes.filter((change) =>
    reviewPaths.has(change.path)
  );
  const hasReviewSelection = selectedForReview.length > 0;
  const changesToPush = hasReviewSelection ? selectedForReview : changes;
  if (!github) {
    return <p className="activity-empty">GitHub integration is unavailable.</p>;
  }
  const pushChanges = () => {
    if (!account || !baseline || !changesToPush.length || !commitMessage.trim())
      return;
    setPushing(true);
    setPushMessage('');
    void runActivity('Pushing changes to GitHub…', () =>
      pushGithubChanges(
        github.roomId,
        github.accessKey,
        commitMessage,
        changesToPush,
        targetBranch || baseline.branch
      )
    )
      .then((result) => {
        github.onBaselineChange(result.baseline);
        setCommitMessage('');
        setReviewPaths(new Set());
        setPushMessage(`Pushed to ${result.baseline.branch}.`);
      })
      .catch((reason: unknown) => {
        setPushMessage(userFacingError(reason, 'Could not push changes.'));
      })
      .finally(() => setPushing(false));
  };
  const repositoryActions = (
    <GithubSourceControlRemoteActions
      key={`${account?.login ?? ''}:${baseline?.owner ?? ''}/${baseline?.name ?? ''}:${baseline?.baseCommitSha ?? ''}:${baseline?.branch ?? ''}`}
      github={github}
      canManageRepositories={canManageRepositories}
      onOpenGithub={onOpenGithub}
      onTargetBranchChange={setTargetBranch}
    />
  );

  return (
    <div className="activity-source-control">
      {github.baseline ? (
        <>
          <div className="source-control-commit-area">
            <textarea
              rows={1}
              aria-label="Commit message"
              placeholder="Message"
              value={commitMessage}
              maxLength={200}
              disabled={isPushing || !account}
              onChange={(event) => setCommitMessage(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  pushChanges();
                }
              }}
              className="chat-message-input source-control-commit-input"
            />
            <button
              type="button"
              className="source-control-commit-button"
              disabled={
                isPushing ||
                !account ||
                !commitMessage.trim() ||
                !changesToPush.length
              }
              onClick={pushChanges}
            >
              {isPushing
                ? 'Pushing…'
                : hasReviewSelection
                  ? `Commit and push (${selectedForReview.length} selected)`
                  : 'Commit and push all changes'}
            </button>
            {pushMessage && (
              <p className="source-control-message" role="status">
                {pushMessage}
              </p>
            )}
          </div>
          <SourceControlPanel
            title="Changes"
            count={changes.length}
            defaultOpen
            className="source-control-changes-panel"
          >
            <ScrollbarPanel
              className="source-control-change-list"
              aria-label="Changed files"
            >
              {changes.length > 0 &&
                changes.map((change) => (
                  <SourceControlChangeRow
                    key={change.path}
                    change={change}
                    selectedForReview={reviewPaths.has(change.path)}
                    canSelect={!isPushing}
                    onReviewChange={onOpenChange}
                    onToggleReview={() =>
                      setReviewPaths((current) => {
                        const next = new Set(current);
                        if (next.has(change.path)) next.delete(change.path);
                        else next.add(change.path);
                        return next;
                      })
                    }
                  />
                ))}
            </ScrollbarPanel>
          </SourceControlPanel>
        </>
      ) : null}
      {repositoryActions}
    </div>
  );
}

function SourceControlChangeRow({
  change,
  selectedForReview,
  canSelect,
  onReviewChange,
  onToggleReview,
}: {
  change: GithubChangeStatus;
  selectedForReview: boolean;
  canSelect: boolean;
  onReviewChange: (change: GithubChangeStatus) => void;
  onToggleReview: () => void;
}) {
  const slash = change.path.lastIndexOf('/');
  const name = slash >= 0 ? change.path.slice(slash + 1) : change.path;
  const directory = slash >= 0 ? change.path.slice(0, slash) : '';
  const reviewLabel = selectedForReview
    ? 'Remove from review'
    : 'Select for review';
  return (
    <div
      className={`source-control-change-row${selectedForReview ? ' is-selected' : ''}`}
    >
      <button
        type="button"
        className="source-control-change-file"
        title={`Review changes in ${change.path}`}
        onClick={() => onReviewChange(change)}
      >
        <Icon
          className="source-control-change-file-icon"
          icon={getFileIcon({ name, isFolder: false }, false)}
          aria-hidden="true"
        />
        <span className="source-control-change-file-copy">
          <span className="source-control-change-file-name">{name}</span>
          {directory ? (
            <span className="source-control-change-file-dir">{directory}</span>
          ) : null}
        </span>
        <FileExplorerGitIndicator
          status={{ kind: change.kind, changeCount: 1 }}
        />
      </button>
      <button
        type="button"
        className="source-control-stage-button"
        aria-label={`${reviewLabel} ${change.path}`}
        aria-pressed={selectedForReview}
        title={reviewLabel}
        disabled={!canSelect}
        onClick={onToggleReview}
      >
        <Icon
          icon={selectedForReview ? 'codicon:check' : 'codicon:add'}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

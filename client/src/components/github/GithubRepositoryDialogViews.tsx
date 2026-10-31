import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import type { GithubChangeStatus } from '../../github/changeTracker';
import type {
  GithubRepositoryBaseline,
  GithubRepositoryImportResponse,
} from '../../github/githubTypes';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';
import { projectFileListViewportHeight } from '../project/projectFileListLayout';

export interface RepositoryChangesViewProps {
  baseline: GithubRepositoryBaseline;
  changes: GithubChangeStatus[];
  commitMessage: string;
  onCommitMessageChange: (message: string) => void;
  branchName: string;
  onBranchNameChange: (branchName: string) => void;
  branchUrl: string;
  compareUrl: string;
}

export function RepositoryChangesView({
  baseline,
  changes,
  commitMessage,
  onCommitMessageChange,
  branchName,
  onBranchNameChange,
  branchUrl,
  compareUrl,
}: RepositoryChangesViewProps) {
  return (
    <>
      <p className="github-repository-summary">
        {baseline.owner}/{baseline.name} · {baseline.branch}
      </p>
      <p className="project-import-warning">
        Changes are shared with everyone in this room. Only your GitHub session
        is used when you push.
      </p>
      <ScrollbarPanel
        className="project-import-list github-changes-list"
        aria-label="GitHub changes"
      >
        {changes.length === 0 ? (
          <p className="github-repository-empty">No changes to push.</p>
        ) : (
          changes.map((change) => (
            <div className="github-change-row" key={change.path}>
              <span className={`github-change-kind is-${change.kind}`}>
                {change.kind}
              </span>
              <span className="project-import-path" title={change.path}>
                {change.path}
              </span>
            </div>
          ))
        )}
      </ScrollbarPanel>
      {changes.length > 0 && (
        <>
          <label className="github-commit-label" htmlFor="github-branch-name">
            Branch name
          </label>
          <input
            id="github-branch-name"
            className="github-commit-input"
            value={branchName}
            maxLength={255}
            placeholder="Leave blank to generate one"
            onChange={(event) => onBranchNameChange(event.currentTarget.value)}
          />
          <label
            className="github-commit-label"
            htmlFor="github-commit-message"
          >
            Commit message
          </label>
          <textarea
            id="github-commit-message"
            className="github-commit-input"
            rows={3}
            value={commitMessage}
            maxLength={200}
            onChange={(event) =>
              onCommitMessageChange(event.currentTarget.value)
            }
          />
          <p className="github-push-target">
            Push to a new branch based on {baseline.branch}.
          </p>
        </>
      )}
      {branchUrl && (
        <p className="github-push-links">
          <a href={branchUrl} target="_blank" rel="noreferrer">
            View branch
          </a>
          {' · '}
          <a href={compareUrl} target="_blank" rel="noreferrer">
            Open pull request
          </a>
        </p>
      )}
    </>
  );
}

export interface RepositoryImportViewState {
  repositoryInput: string;
  error: string;
  notice: string;
  isBusy: boolean;
  isImporting: boolean;
  canImport: boolean;
  preview: GithubRepositoryImportResponse | null;
  selectedPaths: Set<string>;
  selectedCount: number;
  selectedBytes: number;
  importedCount: number;
  importedPaths: Set<string>;
  canAuthorizePrivate: boolean;
}

export interface RepositoryImportViewActions {
  onRepositoryInputChange: (value: string) => void;
  onReview: () => void;
  onSelectedPathsChange: Dispatch<SetStateAction<Set<string>>>;
  onAuthorizePrivate: () => void;
}

export interface RepositoryImportViewProps {
  state: RepositoryImportViewState;
  actions: RepositoryImportViewActions;
}

export function RepositoryImportView({
  state,
  actions,
}: RepositoryImportViewProps) {
  return (
    <>
      <RepositoryReviewForm state={state} actions={actions} />
      {state.preview && (
        <RepositoryImportPreview state={state} actions={actions} />
      )}
      {state.canAuthorizePrivate && (
        <button
          className="project-action-button"
          type="button"
          onClick={actions.onAuthorizePrivate}
        >
          Authorize private repository access
        </button>
      )}
    </>
  );
}

function RepositoryReviewForm({ state, actions }: RepositoryImportViewProps) {
  const error =
    state.error ||
    (!state.canImport ? 'Only room admins can import a repository.' : '');
  const warning = state.preview
    ? 'The current room project will be replaced. Everyone in this room will see the imported files. Review the included and skipped paths.'
    : '';
  const message = error || [warning, state.notice].filter(Boolean).join(' ');
  return (
    <>
      <label className="github-commit-label" htmlFor="github-repository-url">
        Repository URL
      </label>
      <div className="github-repository-input-row">
        <input
          id="github-repository-url"
          className="github-commit-input"
          placeholder="https://github.com/owner/repository"
          value={state.repositoryInput}
          onChange={(event) =>
            actions.onRepositoryInputChange(event.currentTarget.value)
          }
          onKeyDown={(event) =>
            handleRepositoryInputKeyDown(event, actions.onReview)
          }
          disabled={state.isBusy || !state.canImport}
        />
        <button
          className="project-action-button github-repository-action-button"
          type="button"
          onClick={actions.onReview}
          disabled={isRepositoryReviewDisabled(state)}
        >
          {getRepositoryReviewLabel(state.isBusy && !state.isImporting)}
        </button>
      </div>
      {message ? (
        <span
          className={`github-repository-inline-message${error ? ' is-error' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          {message}
        </span>
      ) : null}
    </>
  );
}

function handleRepositoryInputKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  onReview: () => void
): void {
  if (event.key === 'Enter') onReview();
}

function isRepositoryReviewDisabled(state: RepositoryImportViewState): boolean {
  return (
    state.isBusy ||
    Boolean(state.preview) ||
    !state.canImport ||
    !state.repositoryInput.trim()
  );
}

function getRepositoryReviewLabel(isBusy: boolean): string {
  return isBusy ? 'Reading…' : 'Review';
}

function RepositoryImportPreview({
  state,
  actions,
}: RepositoryImportViewProps) {
  const preview = state.preview;
  if (!preview) return null;
  return (
    <>
      <p className="github-repository-summary">
        {preview.baseline.owner}/{preview.baseline.name} ·{' '}
        {preview.baseline.branch} ·{' '}
        {state.isBusy && state.importedCount > 0
          ? `Importing ${state.importedCount} of ${state.selectedCount}`
          : `${state.selectedCount} selected · ${(state.selectedBytes / 1024).toFixed(1)} KB of 1 MB · 64 KB max per file · ${preview.skipped.length} skipped`}
      </p>
      <RepositoryImportFileList
        preview={preview}
        selectedPaths={state.selectedPaths}
        importedPaths={state.importedPaths}
        onSelectedPathsChange={actions.onSelectedPathsChange}
        isBusy={state.isBusy}
      />
    </>
  );
}

interface RepositoryImportFileListProps {
  preview: GithubRepositoryImportResponse;
  selectedPaths: Set<string>;
  importedPaths: Set<string>;
  onSelectedPathsChange: Dispatch<SetStateAction<Set<string>>>;
  isBusy: boolean;
}

function RepositoryImportFileList({
  preview,
  selectedPaths,
  importedPaths,
  onSelectedPathsChange,
  isBusy,
}: RepositoryImportFileListProps) {
  const remainingFiles = preview.files.filter(
    (file) => !importedPaths.has(file.path)
  );
  return (
    <ScrollbarPanel
      className="project-import-list"
      style={{
        height: projectFileListViewportHeight(
          remainingFiles.length + preview.skipped.length
        ),
        maxHeight: '42vh',
        flex: '0 1 auto',
      }}
      aria-label="Repository files to import"
    >
      {remainingFiles.map((file) => (
        <label className="project-import-row" key={file.path}>
          <input
            type="checkbox"
            checked={selectedPaths.has(file.path)}
            disabled={isBusy}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              onSelectedPathsChange((current) => {
                const next = new Set(current);
                if (checked) next.add(file.path);
                else next.delete(file.path);
                return next;
              });
            }}
          />
          <span className="project-import-path" title={file.path}>
            {file.path}
          </span>
          <span className="project-import-size">
            {(file.size / 1024).toFixed(1)} KB
          </span>
        </label>
      ))}
      {preview.skipped.map((file) => (
        <div className="project-import-row is-skipped" key={file.path}>
          <span className="project-import-skipped-label">Skipped</span>
          <span className="project-import-path" title={file.path}>
            {file.path}
          </span>
          <span className="project-import-skip-reason">{file.reason}</span>
        </div>
      ))}
    </ScrollbarPanel>
  );
}

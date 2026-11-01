import type { GithubChangeStatus } from '../../github/changeTracker';
import type { GithubRepositoryBaseline } from '../../github/githubTypes';
import type { useGithubRepositoryDialog } from './useGithubRepositoryDialog';
import {
  RepositoryChangesView,
  RepositoryImportView,
} from './GithubRepositoryDialogViews';

export interface GithubRepositoryDialogContentProps {
  baseline: GithubRepositoryBaseline | null;
  changes: GithubChangeStatus[];
  canImport: boolean;
  dialog: ReturnType<typeof useGithubRepositoryDialog>;
  forceRepositoryPicker?: boolean;
}

export function GithubRepositoryDialogContent({
  baseline,
  changes,
  canImport,
  dialog,
  forceRepositoryPicker = false,
}: GithubRepositoryDialogContentProps) {
  const visibleBaseline =
    dialog.isImporting || forceRepositoryPicker ? null : baseline;
  return (
    <>
      <div className="editor-file-picker-heading">
        <h2 id="github-repository-title">
          {visibleBaseline ? 'GitHub changes' : 'Open a GitHub repository'}
        </h2>
        <button
          type="button"
          disabled={dialog.isImporting}
          onClick={dialog.close}
        >
          Close
        </button>
      </div>
      <RepositoryContent
        baseline={visibleBaseline}
        changes={changes}
        canImport={canImport}
        dialog={dialog}
      />
      <GithubRepositoryDialogActions
        baseline={visibleBaseline}
        changes={changes}
        canImport={canImport}
        dialog={dialog}
      />
    </>
  );
}

function RepositoryContent({
  baseline,
  changes,
  canImport,
  dialog,
}: GithubRepositoryDialogContentProps) {
  if (!baseline) {
    return (
      <RepositoryImportView
        state={{
          repositoryInput: dialog.repositoryInput,
          error: dialog.error,
          notice: dialog.notice,
          isBusy: dialog.isBusy,
          isImporting: dialog.isImporting,
          canImport,
          preview: dialog.preview,
          selectedPaths: dialog.selectedPaths,
          selectedCount: dialog.selectedFiles.length,
          selectedBytes: dialog.selectedBytes,
          importedCount: dialog.importedCount,
          importedPaths: dialog.importedPaths,
          canAuthorizePrivate: shouldAuthorizePrivateRepository(
            dialog,
            canImport
          ),
        }}
        actions={{
          onRepositoryInputChange: dialog.setRepositoryInput,
          onReview: () => void dialog.handleReview(),
          onSelectedPathsChange: dialog.setSelectedPaths,
          onAuthorizePrivate: () => void dialog.authorize('repo'),
        }}
      />
    );
  }

  return (
    <RepositoryChangesView
      baseline={baseline}
      changes={changes}
      commitMessage={dialog.commitMessage}
      onCommitMessageChange={dialog.setCommitMessage}
      branchName={dialog.branchName}
      onBranchNameChange={dialog.setBranchName}
      branchUrl={dialog.branchUrl}
      compareUrl={dialog.compareUrl}
    />
  );
}

function shouldAuthorizePrivateRepository(
  dialog: ReturnType<typeof useGithubRepositoryDialog>,
  canImport: boolean
): boolean {
  return Boolean(
    Boolean(dialog.error) &&
    canImport &&
    dialog.configured &&
    !hasPrivateRepositoryScope(dialog.account)
  );
}

function hasPrivateRepositoryScope(
  account: ReturnType<typeof useGithubRepositoryDialog>['account']
): boolean {
  return account?.canPushPrivateRepositories === true;
}

function GithubRepositoryDialogActions({
  baseline,
  changes,
  canImport,
  dialog,
}: GithubRepositoryDialogContentProps) {
  const error = baseline ? dialog.error : null;
  const notice = !error && dialog.notice ? dialog.notice : null;
  const logMessage = error ?? notice;

  if (!baseline && !dialog.preview) {
    return null;
  }

  return (
    <div className="project-import-actions">
      {logMessage && (
        <span
          className={`github-repository-log-message ${
            error ? 'is-error' : 'is-notice'
          }`}
          aria-live="polite"
          role={error ? 'alert' : 'status'}
        >
          {logMessage}
        </span>
      )}
      <RepositoryActionButton
        baseline={baseline}
        changes={changes}
        canImport={canImport}
        dialog={dialog}
      />
    </div>
  );
}

function RepositoryActionButton(props: GithubRepositoryDialogContentProps) {
  return props.baseline ? (
    <RepositoryPushButton {...props} />
  ) : (
    <RepositoryImportButton {...props} />
  );
}

function RepositoryPushButton({
  changes,
  dialog,
}: GithubRepositoryDialogContentProps) {
  return (
    <button
      className="project-action-button github-repository-action-button"
      type="button"
      onClick={() => void dialog.handlePush()}
      hidden={changes.length === 0}
      disabled={dialog.isBusy || !dialog.commitMessage.trim()}
    >
      {dialog.isBusy
        ? 'Pushing…'
        : dialog.canPush
          ? 'Confirm and push'
          : 'Authorize push'}
    </button>
  );
}

function RepositoryImportButton({
  canImport,
  dialog,
}: GithubRepositoryDialogContentProps) {
  return (
    <button
      className="project-action-button github-repository-action-button"
      type="button"
      onClick={() => void dialog.handleImport()}
      hidden={!dialog.preview}
      disabled={
        dialog.isBusy || dialog.selectedFiles.length === 0 || !canImport
      }
    >
      {dialog.isBusy ? 'Importing…' : 'Import'}
    </button>
  );
}

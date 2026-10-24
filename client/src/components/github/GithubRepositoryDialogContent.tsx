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
}

export function GithubRepositoryDialogContent({
  baseline,
  changes,
  canImport,
  dialog,
}: GithubRepositoryDialogContentProps) {
  return (
    <>
      <h2 id="github-repository-title">
        {baseline ? 'GitHub changes' : 'Open a GitHub repository'}
      </h2>
      <RepositoryContent
        baseline={baseline}
        changes={changes}
        canImport={canImport}
        dialog={dialog}
      />
      {dialog.error && (
        <p className="project-import-error" role="alert">
          {dialog.error}
        </p>
      )}
      {dialog.notice && (
        <p className="github-repository-notice" role="status">
          {dialog.notice}
        </p>
      )}
      <GithubRepositoryDialogActions
        baseline={baseline}
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
          isBusy: dialog.isBusy,
          canImport,
          preview: dialog.preview,
          selectedPaths: dialog.selectedPaths,
          selectedCount: dialog.selectedFiles.length,
          selectedBytes: dialog.selectedBytes,
        canAuthorizePrivate: shouldAuthorizePrivateRepository(dialog, canImport),
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
  return (
    <div className="project-import-actions">
      <button
        className="project-action-button github-repository-action-button github-dialog-close"
        type="button"
        onClick={dialog.close}
        disabled={dialog.isBusy}
      >
        Close
      </button>
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
      className="project-action-button"
      type="button"
      onClick={() => void dialog.handlePush()}
      hidden={changes.length === 0}
      disabled={dialog.isBusy || !dialog.commitMessage.trim()}
    >
      {dialog.isBusy ? 'Pushing…' : dialog.canPush ? 'Confirm and push' : 'Authorize push'}
    </button>
  );
}

function RepositoryImportButton({
  canImport,
  dialog,
}: GithubRepositoryDialogContentProps) {
  return (
    <button
      className="project-action-button"
      type="button"
      onClick={() => void dialog.handleImport()}
      hidden={!dialog.preview}
      disabled={
        dialog.isBusy || dialog.selectedFiles.length === 0 || !canImport
      }
    >
      {dialog.isBusy ? 'Importing…' : 'Import selected'}
    </button>
  );
}

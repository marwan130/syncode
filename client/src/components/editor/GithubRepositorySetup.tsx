import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { GithubRepositoryExplorerProps } from './fileExplorerTypes';
import { GithubLoginButton } from '../github/GithubLoginButton';
import { GithubRepositoryUrlForm } from './GithubRepositoryUrlForm';
import { useAppActivity } from '../shared/useAppActivity';
import { userFacingError } from '../../utils/userFacingError';
import { createGithubRepository } from '../../github/repositoryBrowser';
import { useState } from 'react';

interface GithubRepositorySetupProps {
  accountSignedIn: boolean;
  canManageRepositories: boolean;
  github: GithubRepositoryExplorerProps;
  onOpenGithub: (repositoryUrl?: string) => void;
  onTargetBranchChange: (branch: string) => void;
  repositoryPickerButton: ReactNode;
  error: string;
  setError: Dispatch<SetStateAction<string>>;
}

export function GithubRepositorySetup(props: GithubRepositorySetupProps) {
  return props.accountSignedIn ? (
    <SignedInRepositorySetup {...props} />
  ) : (
    <SignedOutRepositorySetup {...props} />
  );
}

function SignedOutRepositorySetup({
  canManageRepositories,
  onOpenGithub,
}: GithubRepositorySetupProps) {
  return (
    <div className="source-control-empty-repository">
      <GithubRepositoryUrlForm
        onOpenGithub={onOpenGithub}
        disabled={!canManageRepositories}
      />
      <div className="source-control-connect">
        <GithubLoginButton
          returnTo={`${window.location.pathname}${window.location.search}`}
          pushScope="public_repo"
          className="profile-github-button"
          disabled={!canManageRepositories}
        />
        <p>
          Sign in to browse your repositories or create one for this workspace.
        </p>
      </div>
    </div>
  );
}

function SignedInRepositorySetup({
  canManageRepositories,
  github,
  onOpenGithub,
  onTargetBranchChange,
  repositoryPickerButton,
  error,
  setError,
}: GithubRepositorySetupProps) {
  return (
    <div className="source-control-empty-repository">
      {repositoryPickerButton}
      <GithubRepositoryUrlForm
        onOpenGithub={onOpenGithub}
        disabled={!canManageRepositories}
      />
      {github.hasWorkspaceFiles && (
        <CreateRepositoryForm
          github={github}
          onTargetBranchChange={onTargetBranchChange}
          setError={setError}
        />
      )}
      {error && (
        <p className="source-control-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function CreateRepositoryForm({
  github,
  onTargetBranchChange,
  setError,
}: Pick<
  GithubRepositorySetupProps,
  'github' | 'onTargetBranchChange' | 'setError'
>) {
  const { runActivity } = useAppActivity();
  const [busy, setBusy] = useState(false);
  const [repositoryName, setRepositoryName] = useState('');
  const [commitMessage, setCommitMessage] = useState('Initial commit');
  const [isPrivate, setPrivate] = useState(true);

  const createRepository = async () => {
    if (!github.canImport || !repositoryName.trim() || !commitMessage.trim())
      return;
    setBusy(true);
    setError('');
    try {
      const result = await runActivity('Creating GitHub repository…', () =>
        createRepositoryForWorkspace(
          github,
          repositoryName.trim(),
          commitMessage.trim(),
          isPrivate
        )
      );
      github.onBaselineChange(result.baseline);
      onTargetBranchChange(result.baseline.branch);
      setRepositoryName('');
    } catch (reason: unknown) {
      setError(
        userFacingError(reason, 'Could not create and push the repository.')
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="source-control-create-repository"
      onSubmit={(event) => {
        event.preventDefault();
        void createRepository();
      }}
    >
      <div className="source-control-create-repository-heading">
        Create a repository from this workspace
      </div>
      <input
        aria-label="New GitHub repository name"
        placeholder="Repository name"
        maxLength={100}
        value={repositoryName}
        onChange={(event) => setRepositoryName(event.currentTarget.value)}
        disabled={busy || !github.canImport}
      />
      <input
        aria-label="First commit message"
        placeholder="First commit message"
        maxLength={200}
        value={commitMessage}
        onChange={(event) => setCommitMessage(event.currentTarget.value)}
        disabled={busy || !github.canImport}
      />
      <label className="source-control-repository-visibility">
        <input
          type="checkbox"
          checked={isPrivate}
          onChange={(event) => setPrivate(event.currentTarget.checked)}
          disabled={busy || !github.canImport}
        />
        Private repository
      </label>
      <button
        type="submit"
        disabled={
          busy ||
          !github.canImport ||
          !repositoryName.trim() ||
          !commitMessage.trim()
        }
      >
        {busy ? 'Creating and pushing…' : 'Create and push'}
      </button>
      {!github.canImport && (
        <p>Only a room admin can connect a repository for everyone.</p>
      )}
      {isPrivate && (
        <GithubLoginButton
          returnTo={`${window.location.pathname}${window.location.search}`}
          authorizeScope="repo"
          label="Grant GitHub access"
          className="source-control-grant-access-button"
        />
      )}
    </form>
  );
}

async function createRepositoryForWorkspace(
  github: GithubRepositoryExplorerProps,
  name: string,
  message: string,
  isPrivate: boolean
) {
  const grant = await github.onRequestAdminGrant();
  return createGithubRepository(
    {
      roomId: github.roomId,
      accessKey: github.accessKey,
      name,
      message,
      isPrivate,
    },
    grant
  );
}

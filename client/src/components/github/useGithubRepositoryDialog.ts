import { useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useGithubAuth } from '../../github/useGithubAuth';
import type { GithubChangeStatus } from '../../github/changeTracker';
import { pushGithubChanges } from '../../github/commitPush';
import {
  baselineForSelectedFiles,
  parseGithubRepositoryInput,
  reviewGithubRepository,
} from '../../github/repoImport';
import type {
  GithubRepositoryBaseline,
  GithubRepositoryImportResponse,
} from '../../github/githubTypes';
import type { ImportedFileContent } from '../../import/folderImport';

export interface GithubRepositoryDialogActions {
  roomId: string;
  accessKey: string;
  baseline: GithubRepositoryBaseline | null;
  changes: GithubChangeStatus[];
  onRequestAdminGrant: () => Promise<string>;
  onClose: () => void;
  onImport: (
    files: ImportedFileContent[],
    baseline: GithubRepositoryBaseline
  ) => Promise<void>;
  onBaselineChange: (baseline: GithubRepositoryBaseline) => void;
}

export function useGithubRepositoryDialog({
  roomId,
  accessKey,
  baseline,
  changes,
  onRequestAdminGrant,
  onClose,
  onImport,
  onBaselineChange,
}: GithubRepositoryDialogActions) {
  const { account, configured, login } = useGithubAuth();
  const state = useGithubRepositoryDialogState();
  const {
    repositoryInput,
    setRepositoryInput,
    preview,
    setPreview,
    selectedPaths,
    setSelectedPaths,
    commitMessage,
    setCommitMessage,
    error,
    setError,
    notice,
    setNotice,
    isBusy,
    setBusy,
    branchUrl,
    setBranchUrl,
    compareUrl,
    setCompareUrl,
    selectedFiles,
    selectedBytes,
  } = state;
  const requiredScope = baseline?.isPrivate ? 'repo' : 'public_repo';
  const canPush = hasRepositoryPushPermission(baseline, account);

  const close = () => {
    setError('');
    setNotice('');
    setBranchUrl('');
    setCompareUrl('');
    onClose();
  };

  const authorize = async (
    scope: 'public_repo' | 'repo',
    successNotice = 'GitHub access was updated. Reopen the panel to continue.'
  ) => {
    const popup = window.open('about:blank', '_blank', 'popup,width=520,height=680');
    try {
      await login(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
        popup,
        scope
      );
      setNotice(successNotice);
    } catch (reason) {
      popup?.close();
      setError(messageFor(reason, 'Could not authorize GitHub access.'));
    }
  };

  const handleReview = async () => {
    setPreview(null);
    await runBusyAction(setBusy, setError, 'Could not read this GitHub repository.', async () => {
      const repository = parseGithubRepositoryInput(repositoryInput);
      const adminGrant = await onRequestAdminGrant();
      if (!adminGrant) throw new Error('Only room admins can import a repository.');
      const result = await reviewGithubRepository(repository, roomId, accessKey, adminGrant);
      setPreview(result);
      setSelectedPaths(new Set(result.files.map((file) => file.path)));
    });
  };

  const handleImport = async () => {
    if (!preview || selectedFiles.length === 0) return;
    await runBusyAction(setBusy, setError, 'Could not import this repository.', async () => {
      const selectedBaseline = baselineForSelectedFiles(preview.baseline, selectedFiles);
      await onImport(
        selectedFiles.map(({ path, content }) => ({ path, content })),
        selectedBaseline
      );
      setPreview(null);
      close();
    });
  };

  const handlePush = async () => {
    if (!baseline || changes.length === 0) return;
    if (!canPush) {
      await authorize(requiredScope, 'GitHub access was updated. Push again to continue.');
      return;
    }

    await runBusyAction(setBusy, setError, 'Could not push these changes to GitHub.', async () => {
      const result = await pushGithubChanges(roomId, accessKey, commitMessage, changes);
      onBaselineChange(result.baseline);
      setBranchUrl(result.branchUrl);
      setCompareUrl(result.compareUrl);
      setNotice(`Pushed ${changes.length} file changes as @${account?.login}.`);
    });
  };

  return {
    account,
    configured,
    repositoryInput,
    setRepositoryInput,
    preview,
    selectedPaths,
    setSelectedPaths,
    commitMessage,
    setCommitMessage,
    error,
    notice,
    isBusy,
    branchUrl,
    compareUrl,
    selectedFiles,
    selectedBytes,
    canPush,
    close,
    authorize,
    handleReview,
    handleImport,
    handlePush,
  };
}

function useGithubRepositoryDialogState() {
  const [repositoryInput, setRepositoryInput] = useState('');
  const [preview, setPreview] =
    useState<GithubRepositoryImportResponse | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set()
  );
  const [commitMessage, setCommitMessage] = useState('Update project');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isBusy, setBusy] = useState(false);
  const [branchUrl, setBranchUrl] = useState('');
  const [compareUrl, setCompareUrl] = useState('');
  const selectedFiles = useMemo(
    () => preview?.files.filter((file) => selectedPaths.has(file.path)) ?? [],
    [preview, selectedPaths]
  );

  return {
    repositoryInput,
    setRepositoryInput,
    preview,
    setPreview,
    selectedPaths,
    setSelectedPaths,
    commitMessage,
    setCommitMessage,
    error,
    setError,
    notice,
    setNotice,
    isBusy,
    setBusy,
    branchUrl,
    setBranchUrl,
    compareUrl,
    setCompareUrl,
    selectedFiles,
    selectedBytes: selectedFiles.reduce((total, file) => total + file.size, 0),
  };
}

function hasRepositoryPushPermission(
  baseline: GithubRepositoryBaseline | null,
  account: ReturnType<typeof useGithubAuth>['account']
): boolean {
  const permission = baseline?.isPrivate
    ? 'canPushPrivateRepositories'
    : 'canPushPublicRepositories';
  return account?.[permission] === true;
}

async function runBusyAction(
  setBusy: Dispatch<SetStateAction<boolean>>,
  setError: Dispatch<SetStateAction<string>>,
  fallback: string,
  action: () => Promise<void>
): Promise<void> {
  setBusy(true);
  setError('');
  try {
    await action();
  } catch (reason) {
    setError(messageFor(reason, fallback));
  } finally {
    setBusy(false);
  }
}

function messageFor(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}


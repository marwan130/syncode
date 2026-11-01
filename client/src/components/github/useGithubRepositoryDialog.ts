import { useCallback, useMemo, useState } from 'react';
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
import { useAppActivity } from '../shared/useAppActivity';
import { userFacingError } from '../../utils/userFacingError';

export interface GithubRepositoryDialogActions {
  roomId: string;
  accessKey: string;
  baseline: GithubRepositoryBaseline | null;
  changes: GithubChangeStatus[];
  onRequestAdminGrant: () => Promise<string>;
  onClose: () => void;
  onImport: (
    files: ImportedFileContent[],
    baseline: GithubRepositoryBaseline,
    onProgress?: (completedFiles: number) => void
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
  const { runActivity } = useAppActivity();
  const state = useGithubRepositoryDialogState();
  const {
    repositoryInput,
    preview,
    setPreview,
    setSelectedPaths,
    commitMessage,
    branchName,
    setError,
    setNotice,
    setBusy,
    setImporting,
    setImportedCount,
    setImportedPaths,
    setBranchUrl,
    setCompareUrl,
    selectedFiles,
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
    const popup = window.open(
      'about:blank',
      '_blank',
      'popup,width=520,height=680'
    );
    try {
      await login(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
        popup,
        scope
      );
      setNotice(successNotice);
    } catch (reason) {
      popup?.close();
      setError(userFacingError(reason, 'Could not authorize GitHub access.'));
    }
  };

  const reviewRepositoryUrl = useCallback(
    async (repositoryUrl: string) => {
      setPreview(null);
      await runActivity('Loading repository…', () =>
        runBusyAction(
          setBusy,
          setError,
          'Could not read this GitHub repository.',
          async () => {
            const repository = parseGithubRepositoryInput(repositoryUrl);
            const adminGrant = await onRequestAdminGrant();
            if (!adminGrant)
              throw new Error('Only room admins can import a repository.');
            const result = await reviewGithubRepository(
              repository,
              roomId,
              accessKey,
              adminGrant
            );
            setPreview(result);
            setSelectedPaths(new Set(result.files.map((file) => file.path)));
          }
        )
      );
    },
    [
      accessKey,
      onRequestAdminGrant,
      roomId,
      runActivity,
      setBusy,
      setError,
      setPreview,
      setSelectedPaths,
    ]
  );

  const handleReview = () => reviewRepositoryUrl(repositoryInput);

  const handleImport = async () => {
    if (!preview || selectedFiles.length === 0) return;
    setImporting(true);
    setImportedCount(0);
    setImportedPaths(new Set());
    const selectedPaths = selectedFiles.map((file) => file.path);
    try {
      await runActivity('Importing repository…', () =>
        runBusyAction(
          setBusy,
          setError,
          'Could not import this repository.',
          async () => {
            const selectedBaseline = baselineForSelectedFiles(
              preview.baseline,
              selectedFiles
            );
            await onImport(
              selectedFiles.map(({ path, content }) => ({ path, content })),
              selectedBaseline,
              (completed) => {
                setImportedCount(completed);
                setImportedPaths(
                  (previous) =>
                    new Set([...previous, ...selectedPaths.slice(0, completed)])
                );
              }
            );
            setPreview(null);
            close();
          }
        )
      );
    } finally {
      setBusy(false);
      setImporting(false);
    }
  };

  const handlePush = async () => {
    if (!baseline || changes.length === 0) return;
    if (!canPush) {
      await authorize(
        requiredScope,
        'GitHub access was updated. Push again to continue.'
      );
      return;
    }

    await runActivity('Pushing changes to GitHub…', () =>
      runBusyAction(
        setBusy,
        setError,
        'Could not push these changes to GitHub.',
        async () => {
          const result = await pushGithubChanges(
            roomId,
            accessKey,
            commitMessage,
            changes,
            branchName
          );
          onBaselineChange(result.baseline);
          setBranchUrl(result.branchUrl);
          setCompareUrl(result.compareUrl);
          setNotice(
            `Pushed ${changes.length} file changes as @${account?.login}.`
          );
        }
      )
    );
  };

  return {
    ...state,
    account,
    configured,
    canPush,
    close,
    authorize,
    handleReview,
    reviewRepositoryUrl,
    handleImport,
    handlePush,
  };
}

function useGithubRepositoryDialogState() {
  const [repositoryInput, setRepositoryInput] = useState('');
  const [preview, setPreview] = useState<GithubRepositoryImportResponse | null>(
    null
  );
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set()
  );
  const [commitMessage, setCommitMessage] = useState('Update project');
  const [branchName, setBranchName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isBusy, setBusy] = useState(false);
  const [isImporting, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [importedPaths, setImportedPaths] = useState<Set<string>>(
    () => new Set()
  );
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
    branchName,
    setBranchName,
    error,
    setError,
    notice,
    setNotice,
    isBusy,
    setBusy,
    isImporting,
    setImporting,
    importedCount,
    setImportedCount,
    importedPaths,
    setImportedPaths,
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
    if ((reason as { name?: string })?.name !== 'AbortError')
      setError(userFacingError(reason, fallback));
  } finally {
    setBusy(false);
  }
}

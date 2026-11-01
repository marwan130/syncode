import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  createGithubBranch,
  deleteGithubBranch,
  listGithubBranches,
  renameGithubBranch,
} from '../../github/repositoryBrowser';
import type {
  GithubBranchOption,
  GithubRepositoryOption,
} from '../../github/repositoryBrowser';
import type { GithubRepositoryBaseline } from '../../github/githubTypes';
import { useAppFeedback } from '../shared/useAppFeedback';
import { useAppActivity } from '../shared/useAppActivity';
import { userFacingError } from '../../utils/userFacingError';

interface GithubBranchActionsOptions {
  baseline: GithubRepositoryBaseline | null;
  repositories: GithubRepositoryOption[];
  selectedBranch: string;
  setSelectedBranch: Dispatch<SetStateAction<string>>;
  setBranches: Dispatch<SetStateAction<GithubBranchOption[]>>;
  onTargetBranchChange: (branch: string) => void;
  setError: Dispatch<SetStateAction<string>>;
  canImport: boolean;
  onSelectBranch: (branch: string) => Promise<void>;
}

export function useGithubBranchActions({
  baseline,
  repositories,
  selectedBranch,
  setSelectedBranch,
  setBranches,
  onTargetBranchChange,
  setError,
  canImport,
  onSelectBranch,
}: GithubBranchActionsOptions) {
  const { confirm } = useAppFeedback();
  const { runActivity } = useAppActivity();
  const [busy, setBusy] = useState(false);
  const [branchDraft, setBranchDraft] = useState('');
  const [renaming, setRenaming] = useState('');
  const [renameDraft, setRenameDraft] = useState('');

  const openBranch = async (branch: string) => {
    if (!canImport) {
      setError(
        'Only room admins can replace the shared project from a branch.'
      );
      return;
    }
    if (
      !(await confirm(
        `Switch the shared project to ${branch}? This replaces the current room files for everyone.`
      ))
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await runActivity('Switching branch…', () => onSelectBranch(branch));
    } catch (reason) {
      setError(userFacingError(reason, 'Could not open that GitHub branch.'));
    } finally {
      setBusy(false);
    }
  };

  const createBranch = async () => {
    if (!baseline || !branchDraft.trim()) return;
    setBusy(true);
    setError('');
    try {
      await runActivity('Creating branch…', async () => {
        const name = branchDraft.trim();
        await createGithubBranch(
          baseline.owner,
          baseline.name,
          name,
          baseline.branch
        );
        setBranchDraft('');
        setSelectedBranch(name);
        onTargetBranchChange(name);
        setBranches(await listGithubBranches(baseline.owner, baseline.name));
      });
    } catch (reason) {
      setError(userFacingError(reason, 'Could not create the branch.'));
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async () => {
    if (!baseline || !renaming || !renameDraft.trim()) return;
    setBusy(true);
    setError('');
    try {
      await runActivity('Renaming branch…', async () => {
        const oldName = renaming;
        const newName = renameDraft.trim();
        await renameGithubBranch(
          baseline.owner,
          baseline.name,
          oldName,
          newName
        );
        setRenaming('');
        setRenameDraft('');
        if (selectedBranch === oldName) {
          setSelectedBranch(newName);
          onTargetBranchChange(newName);
        }
        setBranches(await listGithubBranches(baseline.owner, baseline.name));
      });
    } catch (reason) {
      setError(userFacingError(reason, 'Could not rename the branch.'));
    } finally {
      setBusy(false);
    }
  };

  const removeBranch = async (branch: GithubBranchOption) => {
    if (!baseline) return;
    const defaultBranch = repositories.find(
      (repository) =>
        repository.owner === baseline.owner && repository.name === baseline.name
    )?.defaultBranch;
    if (branch.name === defaultBranch) {
      setError('The default branch cannot be deleted.');
      return;
    }
    if (
      !(await confirm(
        `Delete the GitHub branch ${branch.name}? This cannot be undone.`
      ))
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await runActivity('Deleting branch…', async () => {
        await deleteGithubBranch(baseline.owner, baseline.name, branch.name);
        setBranches(await listGithubBranches(baseline.owner, baseline.name));
        if (branch.name === selectedBranch && defaultBranch) {
          setSelectedBranch(defaultBranch);
          onTargetBranchChange(defaultBranch);
        }
      });
    } catch (reason) {
      setError(userFacingError(reason, 'Could not delete the branch.'));
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    branchDraft,
    setBranchDraft,
    renaming,
    setRenaming,
    renameDraft,
    setRenameDraft,
    openBranch,
    createBranch,
    saveRename,
    removeBranch,
  };
}

import { useState } from 'react';
import { useGithubAuth } from '../../github/useGithubAuth';
import { userFacingError } from '../../utils/userFacingError';
import { useAppFeedback } from '../shared/useAppFeedback';

export interface GithubLoginButtonProps {
  returnTo: string;
}

export function GithubLoginButton({ returnTo }: GithubLoginButtonProps) {
  const { account, configured, login, logout } = useGithubAuth();
  const { confirm, showMessage } = useAppFeedback();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (!account) {
      const popup = window.open(
        'about:blank',
        '_blank',
        'popup,width=520,height=680'
      );
      try {
        await login(returnTo, popup);
      } catch (error) {
        popup?.close();
        await showMessage(
          userFacingError(error, 'Could not start GitHub sign-in.')
        );
      }
      return;
    }

    if (
      !(await confirm(
        'Sign out of GitHub and clear this browser’s saved session data? Unsynced offline changes will be removed.'
      ))
    )
      return;

    setBusy(true);
    try {
      const revoked = await logout();
      if (!revoked)
        await showMessage(
          'You are signed out in this browser, but GitHub could not revoke the token. Remove Syncode access in your GitHub settings.'
        );
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className="github-auth-button"
      type="button"
      title={
        !configured
          ? 'GitHub sign-in is not configured'
          : account
            ? `Sign out of GitHub (${account.login})`
            : 'Sign in with GitHub'
      }
      aria-label={
        account
          ? `Sign out of GitHub (${account.login})`
          : 'Sign in with GitHub'
      }
      disabled={!configured || busy}
      onClick={() => void handleClick()}
    >
      {account ? `@${account.login}` : 'Sign in with GitHub'}
    </button>
  );
}

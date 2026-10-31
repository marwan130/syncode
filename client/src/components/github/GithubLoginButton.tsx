import { useState } from 'react';
import { useGithubAuth } from '../../github/useGithubAuth';
import { userFacingError } from '../../utils/userFacingError';
import { useAppFeedback } from '../shared/useAppFeedback';

export interface GithubLoginButtonProps {
  returnTo: string;
  pushScope?: 'public_repo' | 'repo';
  authorizeScope?: 'public_repo' | 'repo';
  label?: string;
  className?: string;
  disabled?: boolean;
}

export function GithubLoginButton({
  returnTo,
  pushScope,
  authorizeScope,
  label,
  className = '',
  disabled = false,
}: GithubLoginButtonProps) {
  const { account, configured, login, logout } = useGithubAuth();
  const { confirm, showMessage } = useAppFeedback();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (!account || authorizeScope) {
      const popup = window.open(
        'about:blank',
        '_blank',
        'popup,width=520,height=680'
      );
      try {
        await login(returnTo, popup, authorizeScope ?? pushScope);
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
        'Are you sure you want to sign out of GitHub? Any uncommitted changes will be lost.'
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

  const buttonText =
    label ??
    (authorizeScope
      ? 'Grant GitHub access'
      : account
        ? `Sign out (@${account.login})`
        : 'Sign in with GitHub');

  return (
    <button
      className={`github-auth-button${authorizeScope ? ' is-authorize' : ''}${className ? ` ${className}` : ''}`}
      type="button"
      title={
        !configured
          ? 'GitHub sign-in is not configured'
          : authorizeScope
            ? 'Grant GitHub access'
            : account
              ? `Sign out of GitHub (${account.login})`
              : 'Sign in with GitHub'
      }
      aria-label={
        authorizeScope
          ? 'Grant GitHub access'
          : account
            ? `Sign out of GitHub (${account.login})`
            : 'Sign in with GitHub'
      }
      disabled={!configured || busy || disabled}
      onClick={() => void handleClick()}
    >
      {buttonText && <span className="github-auth-label">{buttonText}</span>}
      <svg
        className="github-logo-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 .9C5.87.9.9 5.87.9 12c0 4.9 3.18 9.06 7.59 10.53.56.1.77-.24.77-.54v-2.1c-3.09.67-3.74-1.31-3.74-1.31-.51-1.29-1.24-1.64-1.24-1.64-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.16 1.71 1.16.99 1.7 2.6 1.21 3.23.92.1-.72.39-1.21.71-1.49-2.47-.28-5.06-1.24-5.06-5.51 0-1.22.44-2.22 1.16-3-.12-.28-.5-1.42.11-2.96 0 0 .95-.3 3.12 1.15a10.9 10.9 0 0 1 5.68 0c2.16-1.45 3.11-1.15 3.11-1.15.62 1.54.23 2.68.12 2.96.72.78 1.15 1.78 1.15 3 0 4.28-2.6 5.22-5.08 5.5.4.35.76 1.02.76 2.06v3.05c0 .3.2.65.78.54A11.1 11.1 0 0 0 23.1 12C23.1 5.87 18.13.9 12 .9Z" />
      </svg>
    </button>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGithubAuth } from '../../github/useGithubAuth';
import {
  announceGithubSessionChanged,
  announceGithubLoginFailed,
  clearPendingGithubLogin,
  consumeGithubPopupLogin,
} from '../../github/githubAuth';

export function GithubOAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { completeLogin } = useGithubAuth();
  const handled = useRef(false);
  const [isPopup] = useState(consumeGithubPopupLogin);
  const code = searchParams.get('code') ?? '';
  const state = searchParams.get('state') ?? '';
  const providerError = searchParams.get('error');
  const [error, setError] = useState(() =>
    providerError || !code || !state
      ? 'GitHub sign-in was cancelled or could not be completed.'
      : ''
  );

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    window.history.replaceState({}, document.title, '/github/callback');

    if (providerError || !code || !state) {
      clearPendingGithubLogin();
      if (isPopup) announceGithubLoginFailed();
      return;
    }

    void completeLogin(code, state)
      .then((returnTo) => {
        if (isPopup) {
          announceGithubSessionChanged();
          window.close();
          return;
        }
        navigate(returnTo, { replace: true });
      })
      .catch((failure: unknown) => {
        if (isPopup) announceGithubLoginFailed();
        const message = failure instanceof Error ? failure.message : '';
        const safeMessages = [
          'GitHub sign-in could not be verified. Try again.',
          'GitHub returned an invalid sign-in request. Start sign-in again.',
          'GitHub sign-in was rejected. Check that you opened the registered local URL.',
          'GitHub could not complete authorization. Check the OAuth app credentials and callback URL.',
          'GitHub sign-in is not configured on the room server. Contact the server administrator.',
          'GitHub sign-in could not be completed. Check that the room server is running and try again.',
        ];
        setError(
          safeMessages.includes(message)
            ? message
            : 'GitHub sign-in could not be completed. Check that the room server is running and try again.'
        );
      });
  }, [code, completeLogin, isPopup, navigate, providerError, state]);

  return (
    <main className="home-page github-callback-page" aria-live="polite">
      <p
        className={error ? 'github-callback-error' : 'github-callback-status'}
        role={error ? 'alert' : 'status'}
      >
        {error || 'Completing GitHub sign-in…'}
      </p>
    </main>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  clearBrowserSession,
  clearCachedAccount,
  clearPendingGithubLogin,
  announceGithubSessionEnded,
  completeGithubLogin,
  getGithubAccount,
  isGithubOAuthConfigured,
  revokeGithubLogin,
  restoreGithubSession,
  startGithubLogin,
  subscribeToGithubSessionChanges,
} from './githubAuth';
import { GithubAuthContext } from './GithubAuthContext';

export function GithubAuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState(getGithubAccount);

  useEffect(() => {
    let active = true;
    void restoreGithubSession()
      .then((restoredAccount) => {
        if (active) setAccount(restoredAccount);
      })
      .catch(() => {
        clearCachedAccount();
        if (active) setAccount(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () =>
      subscribeToGithubSessionChanges((result) => {
        clearPendingGithubLogin();
        if (result === 'signed-out') {
          clearCachedAccount();
          setAccount(null);
          return;
        }
        if (result === 'failed') return;
        void restoreGithubSession()
          .then(setAccount)
          .catch(() => setAccount(null));
      }),
    []
  );

  const login = useCallback(
    (returnTo: string, popup?: Window | null) =>
      startGithubLogin(returnTo, popup),
    []
  );

  const completeLogin = useCallback(async (code: string, state: string) => {
    const result = await completeGithubLogin(code, state);
    setAccount(result.account);
    return result.returnTo;
  }, []);

  const logout = useCallback(async () => {
    setAccount(null);
    let revoked = true;
    try {
      await revokeGithubLogin();
    } catch {
      revoked = false;
    } finally {
      clearBrowserSession();
      announceGithubSessionEnded();
    }
    return revoked;
  }, []);

  const value = useMemo(
    () => ({
      account,
      configured: isGithubOAuthConfigured(),
      login,
      completeLogin,
      logout,
    }),
    [account, completeLogin, login, logout]
  );

  return (
    <GithubAuthContext.Provider value={value}>
      {children}
    </GithubAuthContext.Provider>
  );
}

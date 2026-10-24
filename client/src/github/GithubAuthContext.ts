import { createContext } from 'react';
import type { GithubAccount } from './githubAuth';

export interface GithubAuthValue {
  account: GithubAccount | null;
  configured: boolean;
  login: (
    returnTo: string,
    popup?: Window | null,
    pushScope?: 'public_repo' | 'repo'
  ) => Promise<void>;
  completeLogin: (code: string, state: string) => Promise<string>;
  logout: () => Promise<boolean>;
}

export const GithubAuthContext = createContext<GithubAuthValue | null>(null);

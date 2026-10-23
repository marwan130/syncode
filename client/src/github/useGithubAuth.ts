import { useContext } from 'react';
import { GithubAuthContext } from './GithubAuthContext';

export function useGithubAuth() {
  const value = useContext(GithubAuthContext);
  if (!value) throw new Error('GitHub authentication is unavailable.');
  return value;
}

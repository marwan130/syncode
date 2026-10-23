export interface GithubAccount {
  id: number;
  login: string;
  avatarUrl: string;
}

interface GithubSessionResponse {
  account?: GithubAccount;
}

const ACCOUNT_KEY = 'syncode.github.account';
const LEGACY_TOKEN_KEYS = [
  'syncode.github.token',
  'syncode.github.token-expires-at',
  'syncode.github.refresh-token',
  'syncode.github.refresh-token-expires-at',
];
const STATE_KEY = 'syncode.github.oauth.state';
const VERIFIER_KEY = 'syncode.github.oauth.verifier';
const RETURN_TO_KEY = 'syncode.github.oauth.return-to';
const POPUP_KEY = 'syncode.github.oauth.popup';
const SESSION_CHANNEL = 'syncode.github.session';
const CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID?.trim() ?? '';
const CALLBACK_PATH = '/github/callback';

export function isGithubOAuthConfigured(): boolean {
  return Boolean(CLIENT_ID);
}

export function getGithubAccount(): GithubAccount | null {
  try {
    clearLegacyGithubTokens();
    const raw = sessionStorage.getItem(ACCOUNT_KEY);
    if (!raw) return null;
    const account = JSON.parse(raw) as GithubAccount;
    return Number.isSafeInteger(account.id) && account.login ? account : null;
  } catch {
    return null;
  }
}

function clearLegacyGithubTokens(): void {
  for (const key of LEGACY_TOKEN_KEYS) sessionStorage.removeItem(key);
}

export async function restoreGithubSession(): Promise<GithubAccount | null> {
  const response = await fetch('/api/github/session/refresh', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'include',
    redirect: 'error',
  });
  if (response.status === 401) {
    clearCachedAccount();
    return null;
  }
  if (!response.ok)
    throw new Error('Could not restore GitHub sign-in. Try again shortly.');
  const result = (await response.json()) as GithubSessionResponse;
  if (!isGithubAccount(result.account))
    throw new Error('The GitHub session returned an invalid account.');
  storeAccount(result.account);
  return result.account;
}

export function clearCachedAccount(): void {
  try {
    sessionStorage.removeItem(ACCOUNT_KEY);
  } catch {
    return;
  }
}

export function clearPendingGithubLogin(): void {
  try {
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
  } catch {
    return;
  }
}

export function consumeGithubPopupLogin(): boolean {
  try {
    const isPopup = sessionStorage.getItem(POPUP_KEY) === '1';
    sessionStorage.removeItem(POPUP_KEY);
    return isPopup;
  } catch {
    return false;
  }
}

export function announceGithubSessionChanged(): void {
  announceGithubLoginResult('updated');
}

export function announceGithubLoginFailed(): void {
  announceGithubLoginResult('failed');
}

export function announceGithubSessionEnded(): void {
  announceGithubLoginResult('signed-out');
}

function announceGithubLoginResult(
  result: 'updated' | 'failed' | 'signed-out'
): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  channel.postMessage(result);
  channel.close();
}

export function subscribeToGithubSessionChanges(
  listener: (result: 'updated' | 'failed' | 'signed-out') => void
): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (
      event.data === 'updated' ||
      event.data === 'failed' ||
      event.data === 'signed-out'
    )
      listener(event.data);
  };
  return () => channel.close();
}

export function getPendingGithubReturnTo(): string {
  try {
    const returnTo = sessionStorage.getItem(RETURN_TO_KEY) ?? '/';
    return isSafeReturnPath(returnTo) ? returnTo : '/';
  } catch {
    return '/';
  }
}

export async function startGithubLogin(
  returnTo: string,
  popup?: Window | null
): Promise<void> {
  if (!isGithubOAuthConfigured())
    throw new Error('GitHub sign-in is not configured yet.');

  const state = randomBase64Url(32);
  const verifier = randomBase64Url(48);
  const challenge = await createCodeChallenge(verifier);
  const safeReturnTo = isSafeReturnPath(returnTo) ? returnTo : '/';
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(RETURN_TO_KEY, safeReturnTo);
  if (popup && !popup.closed) {
    popup.sessionStorage.setItem(STATE_KEY, state);
    popup.sessionStorage.setItem(VERIFIER_KEY, verifier);
    popup.sessionStorage.setItem(RETURN_TO_KEY, safeReturnTo);
    popup.sessionStorage.setItem(POPUP_KEY, '1');
  }

  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', CLIENT_ID);
  authorize.searchParams.set(
    'redirect_uri',
    `${window.location.origin}${CALLBACK_PATH}`
  );
  authorize.searchParams.set('scope', 'read:user offline_access');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  if (popup && !popup.closed) {
    popup.opener = null;
    popup.location.assign(authorize.toString());
  } else {
    window.location.assign(authorize.toString());
  }
}

export async function completeGithubLogin(
  code: string,
  receivedState: string
): Promise<{ account: GithubAccount; returnTo: string }> {
  const { verifier, returnTo } = consumeLoginAttempt(receivedState);
  if (!code || code.length > 512)
    throw new Error('GitHub sign-in returned an invalid code.');

  const response = await fetch('/api/github/oauth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      codeVerifier: verifier,
      redirectUri: `${window.location.origin}${CALLBACK_PATH}`,
    }),
    cache: 'no-store',
    credentials: 'include',
    redirect: 'error',
  });
  if (!response.ok) {
    const message =
      response.status === 400
        ? 'GitHub returned an invalid sign-in request. Start sign-in again.'
        : response.status === 403
          ? 'GitHub sign-in was rejected. Check that you opened the registered local URL.'
          : response.status === 502
            ? 'GitHub could not complete authorization. Check the OAuth app credentials and callback URL.'
            : response.status === 503
              ? 'GitHub sign-in is not configured on the room server. Contact the server administrator.'
              : 'GitHub sign-in could not be completed. Check that the room server is running and try again.';
    throw new Error(message);
  }

  const result = (await response.json()) as GithubSessionResponse;
  if (!isGithubAccount(result.account))
    throw new Error('GitHub sign-in returned an invalid account.');
  storeAccount(result.account);
  return {
    account: result.account,
    returnTo: isSafeReturnPath(returnTo) ? returnTo : '/',
  };
}

function consumeLoginAttempt(receivedState: string): {
  verifier: string;
  returnTo: string;
} {
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const returnTo = sessionStorage.getItem(RETURN_TO_KEY) ?? '/';
  clearPendingGithubLogin();
  if (!expectedState || receivedState !== expectedState || !verifier)
    throw new Error('GitHub sign-in could not be verified. Try again.');
  return { verifier, returnTo };
}

export async function revokeGithubLogin(): Promise<void> {
  const response = await fetch('/api/github/session', {
    method: 'DELETE',
    cache: 'no-store',
    credentials: 'include',
    keepalive: true,
    redirect: 'error',
  });
  if (!response.ok) throw new Error('GitHub could not revoke this session.');
}

export function clearBrowserSession(): void {
  clearStorage(localStorage);
  clearStorage(sessionStorage);
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=', 1)[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }
}

function clearStorage(storage: Storage): void {
  try {
    storage.clear();
  } catch {
    return;
  }
}

function storeAccount(account: GithubAccount): void {
  sessionStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

function isGithubAccount(value: unknown): value is GithubAccount {
  if (!value || typeof value !== 'object') return false;
  const account = value as GithubAccount;
  return (
    Number.isSafeInteger(account.id) &&
    typeof account.login === 'string' &&
    /^[A-Za-z0-9-]{1,39}$/.test(account.login) &&
    typeof account.avatarUrl === 'string' &&
    (account.avatarUrl === '' ||
      account.avatarUrl.startsWith('https://avatars.githubusercontent.com/'))
  );
}

function isSafeReturnPath(value: string): boolean {
  return (
    value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
  );
}

function randomBase64Url(byteCount: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  );
  let binary = '';
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

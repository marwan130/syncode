export interface GithubAccount {
  id: number;
  login: string;
  avatarUrl: string;
  canPushPublicRepositories: boolean;
  canPushPrivateRepositories: boolean;
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
const GITHUB_AUTHORIZATION_ENDPOINT =
  'https://github.com/login/oauth/authorize';

export function isGithubOAuthConfigured(): boolean {
  return Boolean(CLIENT_ID);
}

export function getGithubAccount(): GithubAccount | null {
  try {
    clearLegacyGithubTokens();
    const raw = sessionStorage.getItem(ACCOUNT_KEY);
    if (!raw) return null;
    const account: unknown = JSON.parse(raw);
    return isGithubAccount(account) ? account : null;
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
  if (response.status === 429)
    throw new Error(
      'Too many GitHub sign-in requests. Wait a moment and try again.'
    );
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

export async function startGithubLogin(
  returnTo: string,
  popup?: Window | null,
  pushScope?: 'public_repo' | 'repo'
): Promise<void> {
  if (!isGithubOAuthConfigured())
    throw new Error('GitHub sign-in is not configured yet.');

  const state = randomBase64Url(32);
  const verifier = randomBase64Url(48);
  const challenge = await createCodeChallenge(verifier);
  const safeReturnTo = isSafeReturnPath(returnTo) ? returnTo : '/';
  saveLoginAttempt(state, verifier, safeReturnTo, popup);
  navigateToGithub(
    createGithubAuthorizationUrl(state, challenge, pushScope),
    popup
  );
}

export async function completeGithubLogin(
  code: string,
  receivedState: string
): Promise<{ account: GithubAccount; returnTo: string }> {
  const { verifier, returnTo } = consumeLoginAttempt(receivedState);
  validateAuthorizationCode(code);
  const result = await exchangeGithubCode(code, verifier);
  const account = requireGithubAccount(result.account);
  storeAccount(account);
  return {
    account,
    returnTo: isSafeReturnPath(returnTo) ? returnTo : '/',
  };
}

function validateAuthorizationCode(code: string): void {
  if (!code || code.length > 512)
    throw new Error('GitHub sign-in returned an invalid code.');
}

function requireGithubAccount(value: unknown): GithubAccount {
  if (!isGithubAccount(value))
    throw new Error('GitHub sign-in returned an invalid account.');
  return value;
}

async function exchangeGithubCode(
  code: string,
  codeVerifier: string
): Promise<GithubSessionResponse> {
  const response = await fetch('/api/github/oauth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      codeVerifier,
      redirectUri: `${window.location.origin}${CALLBACK_PATH}`,
    }),
    cache: 'no-store',
    credentials: 'include',
    redirect: 'error',
  });
  if (!response.ok) throw new Error(githubExchangeError(response.status));
  return (await response.json()) as GithubSessionResponse;
}

function githubExchangeError(status: number): string {
  const errors: Record<number, string> = {
    400: 'GitHub returned an invalid sign-in request. Start sign-in again.',
    403: 'GitHub sign-in was rejected. Check that you opened the registered local URL.',
    429: 'Too many GitHub sign-in requests. Wait a moment and try again.',
    502: 'GitHub could not complete authorization. Check the OAuth app credentials and callback URL.',
    503: 'GitHub sign-in is not configured on the room server. Contact the server administrator.',
  };
  return (
    errors[status] ??
    'GitHub sign-in could not be completed. Check that the room server is running and try again.'
  );
}

function saveLoginAttempt(
  state: string,
  verifier: string,
  returnTo: string,
  popup?: Window | null
): void {
  storeLoginAttempt(sessionStorage, state, verifier, returnTo);
  if (popup && !popup.closed) {
    storeLoginAttempt(popup.sessionStorage, state, verifier, returnTo);
    popup.sessionStorage.setItem(POPUP_KEY, '1');
  }
}

function storeLoginAttempt(
  storage: Storage,
  state: string,
  verifier: string,
  returnTo: string
): void {
  storage.setItem(STATE_KEY, state);
  storage.setItem(VERIFIER_KEY, verifier);
  storage.setItem(RETURN_TO_KEY, returnTo);
}

function createGithubAuthorizationUrl(
  state: string,
  challenge: string,
  pushScope?: 'public_repo' | 'repo'
): URL {
  const authorize = new URL(GITHUB_AUTHORIZATION_ENDPOINT);
  authorize.searchParams.set('client_id', CLIENT_ID);
  authorize.searchParams.set(
    'redirect_uri',
    `${window.location.origin}${CALLBACK_PATH}`
  );
  authorize.searchParams.set(
    'scope',
    ['read:user', 'offline_access', pushScope].filter(Boolean).join(' ')
  );
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  getTrustedGithubAuthorizationUrl(authorize);
  return authorize;
}

export function getTrustedGithubAuthorizationUrl(authorize: URL): string {
  if (
    authorize.protocol !== 'https:' ||
    authorize.origin !== 'https://github.com' ||
    authorize.pathname !== '/login/oauth/authorize'
  )
    throw new Error('GitHub sign-in could not be started.');
  return authorize.href;
}

function navigateToGithub(authorize: URL, popup?: Window | null): void {
  const target = new URL(getTrustedGithubAuthorizationUrl(authorize));
  const destination = popup && !popup.closed ? popup : window;
  const destinationDocument = destination.document;
  if (destination !== window) destination.opener = null;

  const form = destinationDocument.createElement('form');
  form.method = 'get';
  form.action = GITHUB_AUTHORIZATION_ENDPOINT;
  form.hidden = true;
  target.searchParams.forEach((value, name) => {
    const input = destinationDocument.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.append(input);
  });
  destinationDocument.body.append(form);
  form.submit();
}

function consumeLoginAttempt(receivedState: string): {
  verifier: string;
  returnTo: string;
} {
  const attempt = {
    expectedState: sessionStorage.getItem(STATE_KEY),
    verifier: sessionStorage.getItem(VERIFIER_KEY),
    returnTo: sessionStorage.getItem(RETURN_TO_KEY) ?? '/',
    receivedState,
  };
  clearPendingGithubLogin();
  if (!isValidLoginAttempt(attempt))
    throw new Error('GitHub sign-in could not be verified. Try again.');
  return { verifier: attempt.verifier, returnTo: attempt.returnTo };
}

function isValidLoginAttempt(attempt: {
  expectedState: string | null;
  receivedState: string;
  verifier: string | null;
  returnTo: string;
}): attempt is typeof attempt & { expectedState: string; verifier: string } {
  return Boolean(
    attempt.expectedState &&
    attempt.expectedState === attempt.receivedState &&
    attempt.verifier
  );
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
  const account = value as Partial<GithubAccount>;
  return hasValidGithubIdentity(account) && hasRepositoryPermissions(account);
}

function hasValidGithubIdentity(account: Partial<GithubAccount>): boolean {
  return [
    isValidGithubAccountId(account.id),
    isValidGithubLogin(account.login),
    isValidGithubAvatarUrl(account.avatarUrl),
  ].every(Boolean);
}

function hasRepositoryPermissions(account: Partial<GithubAccount>): boolean {
  return (
    typeof account.canPushPublicRepositories === 'boolean' &&
    typeof account.canPushPrivateRepositories === 'boolean'
  );
}

function isValidGithubAccountId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isValidGithubLogin(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(value);
}

function isValidGithubAvatarUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === '' || value.startsWith('https://avatars.githubusercontent.com/'))
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

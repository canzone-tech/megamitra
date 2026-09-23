import { cookies } from 'next/headers';

export const MEMBER_ACCESS_COOKIE = 'megamitra_member_access';
export const MEMBER_REFRESH_COOKIE = 'megamitra_member_refresh';

export type SessionUser = {
  id: string;
  sessionId: string;
  username: string;
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
};

type TokenBundle = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
  refreshTokenExpiresInSeconds: number;
};

export function apiBaseUrl(): string {
  return (process.env.MEGAMITRA_API_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '');
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.max(0, Math.floor(maxAge)),
  };
}

export async function writeSession(tokens: TokenBundle): Promise<void> {
  const store = await cookies();
  store.set(MEMBER_ACCESS_COOKIE, tokens.accessToken, cookieOptions(tokens.accessTokenExpiresInSeconds));
  store.set(MEMBER_REFRESH_COOKIE, tokens.refreshToken, cookieOptions(tokens.refreshTokenExpiresInSeconds));
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.set(MEMBER_ACCESS_COOKIE, '', cookieOptions(0));
  store.set(MEMBER_REFRESH_COOKIE, '', cookieOptions(0));
}

async function refreshSession(): Promise<string | null> {
  const store = await cookies();
  const refreshToken = store.get(MEMBER_REFRESH_COOKIE)?.value;
  if (!refreshToken) return null;

  const response = await fetch(`${apiBaseUrl()}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  if (!response.ok) {
    await clearSession();
    return null;
  }

  const tokens = (await response.json()) as TokenBundle;
  await writeSession(tokens);
  return tokens.accessToken;
}

export async function authenticatedBackendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const store = await cookies();
  let accessToken = store.get(MEMBER_ACCESS_COOKIE)?.value ?? null;

  const execute = (token: string | null) => {
    const headers = new Headers(init.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    return fetch(`${apiBaseUrl()}${path}`, { ...init, headers, cache: 'no-store' });
  };

  let response = await execute(accessToken);
  if (response.status !== 401) return response;
  accessToken = await refreshSession();
  if (!accessToken) return response;
  response = await execute(accessToken);
  if (response.status === 401) await clearSession();
  return response;
}

export async function loginMember(payload: unknown): Promise<{ response: Response; user?: SessionUser }> {
  const response = await fetch(`${apiBaseUrl()}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  if (!response.ok) return { response };

  const tokens = (await response.json()) as TokenBundle;
  const meResponse = await fetch(`${apiBaseUrl()}/auth/me`, {
    headers: { authorization: `Bearer ${tokens.accessToken}` },
    cache: 'no-store',
  });
  if (!meResponse.ok) return { response: meResponse };
  const user = (await meResponse.json()) as SessionUser;
  await writeSession(tokens);
  return { response, user };
}

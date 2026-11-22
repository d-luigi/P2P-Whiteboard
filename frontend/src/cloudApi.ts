/**
 * A minimal client for Supabase (auth + database), written against its REST endpoints so the
 * app needs no extra package. Pure: it takes the project's URL and public ("anon") key and
 * uses `fetch`, so it can be tested against a fake server (frontend/tests/cloudApi.test.ts).
 *
 *   /auth/v1/...  GoTrue: sign up, sign in, refresh, password reset
 *   /rest/v1/...  PostgREST: the `boards` and `profiles` tables (supabase/schema.sql)
 *
 * The anon key is meant to be public. What protects the data is row level security in the
 * database: a signed-in user can only ever read and write their own rows.
 */
export interface CloudConfig {
  url: string;
  anonKey: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** When the access token stops working (ms since epoch). */
  expiresAt: number;
  userId: string;
  email: string | null;
}

export class CloudError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Row shapes of the two tables, as the server sends them. */
export interface BoardRow {
  user_id: string;
  board_id: string;
  title: string;
  role: 'owner' | 'member';
  owner_key: string | null;
  view_only: boolean;
  password_protected: boolean;
  created_at: number;
  opened_at: number;
  updated_at: number;
  removed: boolean;
}
export interface ProfileRow {
  user_id: string;
  display_name: string;
  color: string;
  updated_at: number;
}

const base = (cfg: CloudConfig) => cfg.url.replace(/\/+$/, '');

function headers(cfg: CloudConfig, token?: string, extra?: Record<string, string>) {
  return { apikey: cfg.anonKey, Authorization: `Bearer ${token ?? cfg.anonKey}`, 'Content-Type': 'application/json', ...extra };
}

async function request(cfg: CloudConfig, path: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${base(cfg)}${path}`, init);
  } catch {
    throw new CloudError('Could not reach the account server. Check your connection.', 0, 'network');
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const o = (body ?? {}) as Record<string, unknown>;
    const message = [o.msg, o.message, o.error_description, o.error].find((m) => typeof m === 'string' && m) as string | undefined;
    const code = [o.error_code, o.code].find((c) => typeof c === 'string') as string | undefined;
    throw new CloudError(message ?? `The account server answered ${res.status}.`, res.status, code);
  }
  return body;
}

/* ---------- auth ---------- */

/** Read a session out of a token response, or out of the pieces of a sign-in link. */
export function readSession(body: unknown): Session | null {
  const o = body as Record<string, unknown> | null;
  if (!o || typeof o.access_token !== 'string' || typeof o.refresh_token !== 'string') return null;
  const user = (o.user ?? {}) as Record<string, unknown>;
  const claims = jwtClaims(o.access_token);
  const userId = typeof user.id === 'string' ? user.id : claims.sub;
  if (!userId) return null;
  const email = typeof user.email === 'string' && user.email ? user.email : claims.email ?? null;
  const expiresIn = typeof o.expires_in === 'number' ? o.expires_in : Number(o.expires_in);
  const expiresAt =
    typeof o.expires_at === 'number' ? o.expires_at * 1000 : Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000;
  return { accessToken: o.access_token, refreshToken: o.refresh_token, expiresAt, userId, email };
}

export function jwtClaims(token: string): { sub?: string; email?: string } {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return {
      sub: typeof json.sub === 'string' ? json.sub : undefined,
      email: typeof json.email === 'string' ? json.email : undefined,
    };
  } catch {
    return {};
  }
}

export async function signUp(cfg: CloudConfig, email: string, password: string, redirectTo?: string) {
  const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
  const body = await request(cfg, `/auth/v1/signup${q}`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ email, password }),
  });
  const session = readSession(body);
  // No session back means the project asks people to confirm their email first.
  return { session, needsConfirmation: !session };
}

export async function signIn(cfg: CloudConfig, email: string, password: string): Promise<Session> {
  const body = await request(cfg, '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ email, password }),
  });
  const session = readSession(body);
  if (!session) throw new CloudError('The account server sent an unexpected answer.', 502);
  return session;
}

export async function refreshSession(cfg: CloudConfig, refreshToken: string): Promise<Session> {
  const body = await request(cfg, '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const session = readSession(body);
  if (!session) throw new CloudError('The account server sent an unexpected answer.', 502);
  return session;
}

export async function requestPasswordReset(cfg: CloudConfig, email: string, redirectTo?: string) {
  const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
  await request(cfg, `/auth/v1/recover${q}`, { method: 'POST', headers: headers(cfg), body: JSON.stringify({ email }) });
}

export async function updatePassword(cfg: CloudConfig, token: string, password: string) {
  await request(cfg, '/auth/v1/user', { method: 'PUT', headers: headers(cfg, token), body: JSON.stringify({ password }) });
}

export async function signOutRemote(cfg: CloudConfig, token: string) {
  try {
    await request(cfg, '/auth/v1/logout', { method: 'POST', headers: headers(cfg, token) });
  } catch {
    /* the token may already be dead: signing out locally is what matters */
  }
}

/* ---------- data ---------- */

export async function fetchBoards(cfg: CloudConfig, token: string): Promise<unknown[]> {
  const body = await request(cfg, '/rest/v1/boards?select=*&order=opened_at.desc&limit=1000', {
    method: 'GET',
    headers: headers(cfg, token),
  });
  return Array.isArray(body) ? body : [];
}

export async function upsertBoards(cfg: CloudConfig, token: string, rows: BoardRow[]) {
  for (let i = 0; i < rows.length; i += 100) {
    await request(cfg, '/rest/v1/boards?on_conflict=user_id,board_id', {
      method: 'POST',
      headers: headers(cfg, token, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows.slice(i, i + 100)),
    });
  }
}

export async function fetchProfile(cfg: CloudConfig, token: string, userId: string): Promise<unknown | null> {
  const body = await request(cfg, `/rest/v1/profiles?select=*&user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'GET',
    headers: headers(cfg, token),
  });
  return Array.isArray(body) && body.length ? body[0] : null;
}

export async function upsertProfile(cfg: CloudConfig, token: string, row: ProfileRow) {
  await request(cfg, '/rest/v1/profiles?on_conflict=user_id', {
    method: 'POST',
    headers: headers(cfg, token, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  });
}

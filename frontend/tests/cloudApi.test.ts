import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as api from '../src/cloudApi.ts';

/** A tiny fake of the Supabase endpoints the app uses. */
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string, email: string) => `${b64({ alg: 'HS256' })}.${b64({ sub, email })}.sig`;

const users = new Map<string, { id: string; password: string; confirmed: boolean }>();
const boards: Record<string, unknown>[] = [];
const profiles: Record<string, unknown>[] = [];
const seen: { path: string; headers: http.IncomingHttpHeaders }[] = [];
let server: http.Server;
let cfg: api.CloudConfig;

const tokenResponse = (id: string, email: string) => ({
  access_token: jwt(id, email),
  refresh_token: `refresh-${id}`,
  expires_in: 3600,
  user: { id, email },
});

before(async () => {
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : {};
    const url = new URL(req.url!, 'http://x');
    seen.push({ path: url.pathname + url.search, headers: req.headers });
    const send = (status: number, obj?: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(obj === undefined ? '' : JSON.stringify(obj));
    };
    let uid: string | null = null;
    try {
      const bearer = req.headers.authorization ?? '';
      if (bearer.startsWith('Bearer ') && bearer !== 'Bearer anon-key') {
        uid = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).sub ?? null;
      }
    } catch {
      uid = null; // a malformed token is simply not signed in
    }
    const authed = uid !== null;

    if (url.pathname === '/auth/v1/signup') {
      if (users.has(body.email)) return send(422, { msg: 'User already registered', error_code: 'user_already_exists' });
      if (body.password.length < 6) return send(422, { msg: 'Password should be at least 6 characters.', error_code: 'weak_password' });
      const id = `uid-${users.size + 1}`;
      users.set(body.email, { id, password: body.password, confirmed: false });
      return send(200, { id, email: body.email }); // no session: confirmation required
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const u = users.get(body.email);
      if (!u || u.password !== body.password) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      if (!u.confirmed) return send(400, { error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
      return send(200, tokenResponse(u.id, body.email));
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      if (body.refresh_token !== 'refresh-uid-1') return send(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
      return send(200, tokenResponse('uid-1', 'a@example.com'));
    }
    if (url.pathname === '/auth/v1/recover') return send(200, {});
    if (url.pathname === '/auth/v1/user' && req.method === 'PUT') return authed ? send(200, { id: uid }) : send(401, { msg: 'no' });
    if (url.pathname === '/auth/v1/logout') return send(204);

    // The database: row level security means only the signed-in user's own rows.
    if (!authed) return send(401, { message: 'permission denied' });
    const table = url.pathname === '/rest/v1/boards' ? boards : url.pathname === '/rest/v1/profiles' ? profiles : null;
    if (!table) return send(404, {});
    const key = (r: Record<string, unknown>) => `${r.user_id}/${r.board_id ?? ''}`;
    if (req.method === 'GET') return send(200, table.filter((r) => r.user_id === uid));
    if (req.method === 'POST') {
      for (const row of Array.isArray(body) ? body : [body]) {
        if (row.user_id !== uid) return send(403, { code: '42501', message: 'new row violates row-level security policy' });
        const i = table.findIndex((r) => key(r) === key(row));
        if (i >= 0) table[i] = row;
        else table.push(row);
      }
      return send(201);
    }
    send(405, {});
  });
  await new Promise<void>((r) => server.listen(0, r));
  cfg = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, anonKey: 'anon-key' };
});
after(() => {
  server.closeAllConnections();
  server.close();
});

test('sign up without a session means "confirm your email"; wrong password and unconfirmed are readable errors', async () => {
  const r = await api.signUp(cfg, 'a@example.com', 'hunter2hunter2', 'https://site.example/');
  assert.equal(r.needsConfirmation, true);
  assert.equal(r.session, null);
  assert.ok(seen.at(-1)!.path.includes('redirect_to=https%3A%2F%2Fsite.example%2F'));
  assert.equal(seen.at(-1)!.headers.apikey, 'anon-key');

  await assert.rejects(api.signUp(cfg, 'a@example.com', 'hunter2hunter2'), /already registered/);
  await assert.rejects(api.signUp(cfg, 'b@example.com', '123'), /at least 6/);
  await assert.rejects(api.signIn(cfg, 'a@example.com', 'wrong'), /Invalid login credentials/);
  await assert.rejects(api.signIn(cfg, 'a@example.com', 'hunter2hunter2'), (e: api.CloudError) => e.code === 'email_not_confirmed');
});

test('sign in returns a usable session; refresh works; a dead refresh token is a 400', async () => {
  users.get('a@example.com')!.confirmed = true;
  const s = await api.signIn(cfg, 'a@example.com', 'hunter2hunter2');
  assert.equal(s.userId, 'uid-1');
  assert.equal(s.email, 'a@example.com');
  assert.ok(s.expiresAt > Date.now() + 3000_000);
  const s2 = await api.refreshSession(cfg, s.refreshToken);
  assert.equal(s2.userId, 'uid-1');
  await assert.rejects(api.refreshSession(cfg, 'stale'), (e: api.CloudError) => e.status === 400);
});

test('boards upload (upsert), download, and cannot be written for someone else', async () => {
  const s = await api.signIn(cfg, 'a@example.com', 'hunter2hunter2');
  const row = (id: string, title: string): api.BoardRow => ({
    user_id: s.userId, board_id: id, title, role: 'member', owner_key: null, view_only: false,
    password_protected: false, created_at: 1, opened_at: 2, updated_at: 3, removed: false,
  });
  await api.upsertBoards(cfg, s.accessToken, [row('board-one', 'One'), row('board-two', 'Two')]);
  await api.upsertBoards(cfg, s.accessToken, [row('board-one', 'One renamed')]);
  const got = (await api.fetchBoards(cfg, s.accessToken)) as api.BoardRow[];
  assert.deepEqual(got.map((r) => r.title).sort(), ['One renamed', 'Two']);
  assert.ok(seen.some((x) => x.path.includes('on_conflict=user_id,board_id')));
  await assert.rejects(api.upsertBoards(cfg, s.accessToken, [{ ...row('board-x', 'X'), user_id: 'someone-else' }]), /row-level security/);
  await assert.rejects(api.fetchBoards(cfg, 'bad.token.here'), (e: api.CloudError) => e.status === 401 || e.status === 403);
});

test('large uploads are sent in batches of 100', async () => {
  const s = await api.signIn(cfg, 'a@example.com', 'hunter2hunter2');
  const before = seen.length;
  const rows = Array.from({ length: 250 }, (_, i): api.BoardRow => ({
    user_id: s.userId, board_id: `bulk-${i}`, title: 'b', role: 'member', owner_key: null, view_only: false,
    password_protected: false, created_at: 1, opened_at: 2, updated_at: 3, removed: false,
  }));
  await api.upsertBoards(cfg, s.accessToken, rows);
  assert.equal(seen.slice(before).filter((x) => x.path.startsWith('/rest/v1/boards')).length, 3);
});

test('profile round-trip; reset email; password change needs a session; network failure is readable', async () => {
  const s = await api.signIn(cfg, 'a@example.com', 'hunter2hunter2');
  assert.equal(await api.fetchProfile(cfg, s.accessToken, s.userId), null);
  await api.upsertProfile(cfg, s.accessToken, { user_id: s.userId, display_name: 'Ada', color: '#e03131', updated_at: 1 });
  assert.equal(((await api.fetchProfile(cfg, s.accessToken, s.userId)) as { display_name: string }).display_name, 'Ada');
  await api.requestPasswordReset(cfg, 'a@example.com', 'https://site.example/');
  await api.updatePassword(cfg, s.accessToken, 'a-new-password');
  await assert.rejects(api.updatePassword(cfg, 'anon-key', 'x'), /no/);
  await api.signOutRemote(cfg, s.accessToken);
  await assert.rejects(api.signIn({ url: 'http://127.0.0.1:1', anonKey: 'k' }, 'a@b.co', 'x'), (e: api.CloudError) => e.code === 'network');
});

test('readSession reads a sign-in link and rejects junk', () => {
  const token = jwt('uid-9', 'z@example.com');
  const s = api.readSession({ access_token: token, refresh_token: 'r', expires_in: '3600', expires_at: undefined })!;
  assert.equal(s.userId, 'uid-9');
  assert.equal(s.email, 'z@example.com');
  assert.equal(api.readSession({ access_token: 'nope', refresh_token: 'r' }), null);
  assert.equal(api.readSession(null), null);
  assert.deepEqual(api.jwtClaims('garbage'), {});
});

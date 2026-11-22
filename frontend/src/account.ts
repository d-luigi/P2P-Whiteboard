import { create } from 'zustand';
import { AUTH_EVENT_KEY, SESSION_KEY } from './authRedirect';
import * as api from './cloudApi';
import { CloudError, type CloudConfig, type Session } from './cloudApi';
import { fromRow, sameEntry, toRow, type BoardEntry } from './registryCore';
import { clearForSignOut, mergeFromAccount, onLocalChange } from './registry';
import { setColor, setName, usePresence } from './presence';
import { toast } from './toast';

/**
 * ACCOUNTS. Optional, and the app works fully without them.
 *
 *  - GUEST (the default): nothing is sent anywhere. Boards you open are listed on this device
 *    (registry.ts) and everything else works as before. There is no "anonymous account" on a
 *    server; being a guest simply means not having one.
 *  - SIGNED IN (email + password, via Supabase): your list of boards, with each board's owner
 *    key, and your display name and colour follow you to every device. Drawings are NOT
 *    stored in the account: boards still live in browsers and sync peer to peer.
 *
 * Boards you opened as a guest are added to your account when you sign in (the lists are
 * merged, see registryCore.ts), so nothing is lost by creating an account later.
 *
 * Turned on by VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (.env.example). Without them the
 * sign-in buttons are hidden and the app behaves exactly as a guest.
 */
const env = import.meta.env as Record<string, string | undefined>;

export const cloudConfig: CloudConfig | null =
  env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY && /^https?:\/\//.test(env.VITE_SUPABASE_URL)
    ? { url: env.VITE_SUPABASE_URL, anonKey: env.VITE_SUPABASE_ANON_KEY }
    : null;

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error';
export type AuthDialog = 'signin' | 'signup' | 'forgot' | 'reset' | null;

interface AccountState {
  configured: boolean;
  session: Session | null;
  sync: SyncStatus;
  syncError: string | null;
  /** Which sign-in dialog is open. */
  dialog: AuthDialog;
  /** The "my boards and account" panel (bottom right) is open. */
  panelOpen: boolean;
}

const readStoredSession = (): Session | null => {
  try {
    const o = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Partial<Session> | null;
    if (
      o &&
      typeof o.accessToken === 'string' &&
      typeof o.refreshToken === 'string' &&
      typeof o.userId === 'string' &&
      typeof o.expiresAt === 'number'
    ) {
      return { accessToken: o.accessToken, refreshToken: o.refreshToken, userId: o.userId, expiresAt: o.expiresAt, email: o.email ?? null };
    }
  } catch {
    /* no usable session */
  }
  return null;
};

export const useAccount = create<AccountState>(() => ({
  configured: !!cloudConfig,
  session: cloudConfig ? readStoredSession() : null,
  sync: 'idle',
  syncError: null,
  dialog: null,
  panelOpen: false,
}));

export const openDialog = (dialog: AuthDialog) => useAccount.setState({ dialog, panelOpen: dialog ? false : useAccount.getState().panelOpen });
export const setPanelOpen = (panelOpen: boolean) => useAccount.setState({ panelOpen });

function storeSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  useAccount.setState({ session });
}

// Another tab signed in, out, or refreshed the session.
window.addEventListener('storage', (e) => {
  if (e.key === SESSION_KEY && cloudConfig) useAccount.setState({ session: readStoredSession() });
});

const withLock = <T>(fn: () => Promise<T>): Promise<T> =>
  navigator.locks ? navigator.locks.request('p2pwb-auth', fn) : fn();

/** A session whose access token is good for at least another minute (refreshing it if needed). */
async function freshSession(): Promise<Session> {
  const cfg = cloudConfig;
  const current = useAccount.getState().session;
  if (!cfg || !current) throw new CloudError('Not signed in.', 401);
  if (current.expiresAt - Date.now() > 60_000) return current;
  return withLock(async () => {
    const stored = readStoredSession(); // another tab may have refreshed while we waited
    if (stored && stored.expiresAt - Date.now() > 60_000) {
      useAccount.setState({ session: stored });
      return stored;
    }
    try {
      const next = await api.refreshSession(cfg, (stored ?? current).refreshToken);
      storeSession(next);
      return next;
    } catch (err) {
      if (err instanceof CloudError && (err.status === 400 || err.status === 401 || err.status === 403)) {
        storeSession(null); // the session is really gone (signed out elsewhere, or expired)
        toast('Your session ended. Sign in again to keep your boards in sync.', 'error');
      }
      throw err;
    }
  });
}

/* ---------- syncing the list of boards and the profile ---------- */

let running: Promise<void> | null = null;
let queued = false;

/** Merge this device's list with the account's and upload what is newer. Calls overlap safely. */
export function syncNow(): Promise<void> {
  if (!cloudConfig || !useAccount.getState().session) return Promise.resolve();
  if (running) {
    queued = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        queued = false;
        await syncOnce();
      } while (queued);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function syncOnce() {
  const cfg = cloudConfig!;
  useAccount.setState({ sync: 'syncing', syncError: null });
  try {
    const s = await freshSession();
    const remote = (await api.fetchBoards(cfg, s.accessToken))
      .map((r) => fromRow(r as Parameters<typeof fromRow>[0]))
      .filter((e): e is BoardEntry => !!e);
    const merged = mergeFromAccount(remote);
    const remoteById = new Map(remote.map((e) => [e.id, e]));
    const toUpload = merged.filter((e) => {
      const r = remoteById.get(e.id);
      return !r || !sameEntry(e, r);
    });
    if (toUpload.length) await api.upsertBoards(cfg, s.accessToken, toUpload.map((e) => toRow(e, s.userId)));
    useAccount.setState({ sync: 'ok', syncError: null });
  } catch (err) {
    useAccount.setState({ sync: 'error', syncError: err instanceof Error ? err.message : 'Sync failed.' });
    throw err;
  }
}

const quietly = (p: Promise<unknown>) => p.catch(() => undefined);

/** Name and colour: the account's copy wins when it has one; otherwise this device's is uploaded. */
async function syncProfile() {
  const cfg = cloudConfig;
  if (!cfg) return;
  const s = await freshSession();
  const row = (await api.fetchProfile(cfg, s.accessToken, s.userId)) as Partial<api.ProfileRow> | null;
  const nameOk = typeof row?.display_name === 'string' && row.display_name.trim();
  const colorOk = typeof row?.color === 'string' && /^#[0-9a-f]{6}$/i.test(row.color);
  if (nameOk && colorOk) {
    suppressProfilePush = true;
    setName(row!.display_name!);
    setColor(row!.color!);
    suppressProfilePush = false;
  } else {
    await pushProfile();
  }
}

let suppressProfilePush = false;
let profileTimer = 0;

async function pushProfile() {
  const cfg = cloudConfig;
  const session = useAccount.getState().session;
  if (!cfg || !session) return;
  const { name, color } = usePresence.getState().me;
  const s = await freshSession();
  await api.upsertProfile(cfg, s.accessToken, { user_id: s.userId, display_name: name, color, updated_at: Date.now() });
}

usePresence.subscribe((state, prev) => {
  if (suppressProfilePush || !useAccount.getState().session) return;
  if (state.me.name === prev.me.name && state.me.color === prev.me.color) return;
  window.clearTimeout(profileTimer);
  profileTimer = window.setTimeout(() => void quietly(pushProfile()), 1500);
});

/* ---------- when to sync ---------- */

let syncTimer = 0;
onLocalChange(() => {
  if (!useAccount.getState().session) return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => void quietly(syncNow()), 2000);
});

let lastFocusSync = 0;
const onWake = () => {
  if (document.visibilityState === 'hidden' || !useAccount.getState().session) return;
  if (Date.now() - lastFocusSync < 30_000) return;
  lastFocusSync = Date.now();
  void quietly(syncNow());
};
window.addEventListener('focus', onWake);
window.addEventListener('online', onWake);
document.addEventListener('visibilitychange', onWake);

/* ---------- signing in and out ---------- */

const redirectTo = () => `${location.origin}${location.pathname}`;
const cfgOrThrow = () => {
  if (!cloudConfig) throw new Error('Accounts are not set up on this site.');
  return cloudConfig;
};

async function afterSignIn(session: Session) {
  storeSession(session);
  openDialog(null);
  try {
    await syncNow();
    await syncProfile();
    toast(session.email ? `Signed in as ${session.email}. Your boards are in sync.` : 'Signed in.');
  } catch {
    toast('Signed in, but syncing your boards did not finish. It will retry.', 'error');
  }
}

export async function signIn(email: string, password: string) {
  await afterSignIn(await api.signIn(cfgOrThrow(), email.trim(), password));
}

/** Returns true if an email must be confirmed first. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const r = await api.signUp(cfgOrThrow(), email.trim(), password, redirectTo());
  if (r.session) {
    await afterSignIn(r.session);
    return false;
  }
  return true;
}

export async function sendPasswordReset(email: string) {
  await api.requestPasswordReset(cfgOrThrow(), email.trim(), redirectTo());
}

export async function setNewPassword(password: string) {
  const s = await freshSession();
  await api.updatePassword(cfgOrThrow(), s.accessToken, password);
  openDialog(null);
  toast('Password changed.');
}

export async function signOut() {
  const cfg = cfgOrThrow();
  const session = useAccount.getState().session;
  if (!session) return;
  try {
    await syncNow(); // make sure nothing only this device knows is lost
  } catch {
    throw new Error("Your board list couldn't be saved to your account, so signing out now could lose it. Check your connection and try again.");
  }
  const s = await freshSession().catch(() => session);
  await api.signOutRemote(cfg, s.accessToken);
  storeSession(null);
  clearForSignOut();
  location.reload(); // a clean start with no account data in memory
}

/* ---------- on page load ---------- */

try {
  const event = sessionStorage.getItem(AUTH_EVENT_KEY);
  sessionStorage.removeItem(AUTH_EVENT_KEY);
  if (event === 'recovery' && cloudConfig && useAccount.getState().session) {
    openDialog('reset');
  } else if (event === 'signedin' && cloudConfig && useAccount.getState().session) {
    window.setTimeout(() => toast('Email confirmed. You are signed in.'), 300);
  } else if (event?.startsWith('error:')) {
    window.setTimeout(() => toast(event.slice(6), 'error'), 300);
  }
} catch {
  /* ignore */
}

if (cloudConfig && useAccount.getState().session) {
  void quietly(syncNow().then(syncProfile));
}



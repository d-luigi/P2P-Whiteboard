/**
 * THE LIST OF MY BOARDS: the pure rules. No browser APIs, so they can be unit tested
 * (frontend/tests/registryCore.test.ts).
 *
 * Every browser keeps a list of the boards it has opened (registry.ts). Signed-in users also
 * have that list in their account (cloud.ts), and the two are merged, so the same list shows
 * up on every device. Guests simply keep the local list and never contact a server.
 *
 * Merging is per board: the entry changed most recently wins. Two things are never lost in a
 * merge: that you own a board (and the owner key that proves it), and the fact that you have
 * edit access rather than view-only. Removing a board from the list leaves a "removed" mark
 * (a tombstone) so the removal reaches your other devices instead of the board coming back.
 */
export interface BoardEntry {
  id: string;
  title: string;
  role: 'owner' | 'member';
  /** Proof of ownership, kept so ownership follows the account. Never put in a link. */
  ownerKey: string | null;
  viewOnly: boolean;
  passwordProtected: boolean;
  createdAt: number;
  openedAt: number;
  updatedAt: number;
  removed: boolean;
}

export const MAX_ENTRIES = 500;
export const TITLE_MAX = 80;
export const DEFAULT_TITLE = 'Untitled board';
/** Opening a board only counts as a change (and is synced) when the last open was this long ago. */
const REOPEN_MS = 10 * 60 * 1000;

const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

const time = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 8.64e15 ? Math.floor(v) : null;

export const cleanTitle = (v: unknown): string => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) : '';
  return t || DEFAULT_TITLE;
};

/** An entry from outside (localStorage, the server): only a well-formed one gets through. */
export function sanitizeEntry(raw: unknown): BoardEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !ID_RE.test(o.id)) return null;
  const createdAt = time(o.createdAt);
  const openedAt = time(o.openedAt);
  const updatedAt = time(o.updatedAt);
  if (createdAt === null || openedAt === null || updatedAt === null) return null;
  const ownerKey = typeof o.ownerKey === 'string' && KEY_RE.test(o.ownerKey) ? o.ownerKey : null;
  return {
    id: o.id,
    title: cleanTitle(o.title),
    role: o.role === 'owner' && ownerKey ? 'owner' : 'member',
    ownerKey,
    viewOnly: o.viewOnly === true,
    passwordProtected: o.passwordProtected === true,
    createdAt,
    openedAt,
    updatedAt,
    removed: o.removed === true,
  };
}

export function sanitizeList(raw: unknown): BoardEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: BoardEntry[] = [];
  for (const item of raw) {
    const e = sanitizeEntry(item);
    if (e && !seen.has(e.id)) {
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}

/** Combine two entries for the same board. The more recently changed one wins; see the header. */
function mergeOne(a: BoardEntry, b: BoardEntry): BoardEntry {
  const [win, lose] = b.updatedAt > a.updatedAt ? [b, a] : [a, b]; // a tie keeps `a` (the local one)
  const ownerKey = win.ownerKey ?? lose.ownerKey;
  return {
    ...win,
    ownerKey,
    role: ownerKey ? 'owner' : win.role,
    viewOnly: win.viewOnly && lose.viewOnly,
    createdAt: Math.min(a.createdAt, b.createdAt),
    openedAt: Math.max(a.openedAt, b.openedAt),
  };
}

/** Keep the most recently opened boards (plus nothing else), newest first. */
export function prune(list: BoardEntry[]): BoardEntry[] {
  return [...list].sort((x, y) => y.openedAt - x.openedAt).slice(0, MAX_ENTRIES);
}

export function mergeEntries(local: BoardEntry[], remote: BoardEntry[]): BoardEntry[] {
  const byId = new Map<string, BoardEntry>();
  for (const e of local) byId.set(e.id, e);
  for (const e of remote) {
    const mine = byId.get(e.id);
    byId.set(e.id, mine ? mergeOne(mine, e) : e);
  }
  return prune([...byId.values()]);
}

export interface Visit {
  id: string;
  viewOnly: boolean;
  passwordProtected: boolean;
  /** Set when this browser holds the owner key for the board. */
  ownerKey?: string | null;
  now: number;
}

/** Record that a board was opened (creating its entry the first time). */
export function recordVisit(list: BoardEntry[], v: Visit): BoardEntry[] {
  const i = list.findIndex((e) => e.id === v.id);
  if (i < 0) {
    const ownerKey = v.ownerKey ?? null;
    const fresh: BoardEntry = {
      id: v.id,
      title: DEFAULT_TITLE,
      role: ownerKey ? 'owner' : 'member',
      ownerKey,
      viewOnly: v.viewOnly,
      passwordProtected: v.passwordProtected,
      createdAt: v.now,
      openedAt: v.now,
      updatedAt: v.now,
      removed: false,
    };
    return prune([...list, fresh]);
  }
  const e = list[i];
  const ownerKey = v.ownerKey ?? e.ownerKey;
  const next: BoardEntry = {
    ...e,
    ownerKey,
    role: ownerKey ? 'owner' : e.role,
    viewOnly: e.removed ? v.viewOnly : e.viewOnly && v.viewOnly, // edit access, once seen, is kept
    passwordProtected: v.passwordProtected,
    removed: false, // opening a board again brings it back to the list
  };
  const changed =
    next.ownerKey !== e.ownerKey ||
    next.viewOnly !== e.viewOnly ||
    next.passwordProtected !== e.passwordProtected ||
    e.removed;
  if (changed || v.now - e.openedAt > REOPEN_MS) {
    next.openedAt = v.now;
    next.updatedAt = v.now;
  }
  const out = [...list];
  out[i] = next;
  return out;
}

/** Change one entry. Returns the same list if nothing changed. */
export function patchEntry(
  list: BoardEntry[],
  id: string,
  patch: Partial<Pick<BoardEntry, 'title' | 'removed'>>,
  now: number,
): BoardEntry[] {
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return list;
  const e = list[i];
  const title = patch.title === undefined ? e.title : cleanTitle(patch.title);
  const removed = patch.removed ?? e.removed;
  if (title === e.title && removed === e.removed) return list;
  const out = [...list];
  out[i] = { ...e, title, removed, updatedAt: now };
  return out;
}

/** What the list shows: not removed, most recently opened first. */
export const visibleEntries = (list: BoardEntry[]) =>
  list.filter((e) => !e.removed).sort((x, y) => y.openedAt - x.openedAt);

/** Entries changed since the last successful upload. */
export const changedSince = (list: BoardEntry[], syncedAt: number) => list.filter((e) => e.updatedAt > syncedAt);

/** The link fragment for opening an entry: edit access if we have it, else the view-only link. */
export function entryFragment(e: BoardEntry): string {
  return e.id + (e.passwordProtected ? '.pw' : '') + (e.viewOnly ? '.view' : '');
}

/* ---------- the shape of a row in the account's `boards` table ---------- */

/** The fields of a server row that registry entries are built from (cloudApi.BoardRow). */
export interface BoardRowLike {
  board_id: unknown;
  title: unknown;
  role: unknown;
  owner_key: unknown;
  view_only: unknown;
  password_protected: unknown;
  created_at: unknown;
  opened_at: unknown;
  updated_at: unknown;
  removed: unknown;
}

const num = (v: unknown) => (typeof v === 'string' ? Number(v) : v); // bigint columns may arrive as strings

export const fromRow = (r: BoardRowLike): BoardEntry | null =>
  sanitizeEntry({
    id: r.board_id,
    title: r.title,
    role: r.role,
    ownerKey: r.owner_key,
    viewOnly: r.view_only,
    passwordProtected: r.password_protected,
    createdAt: num(r.created_at),
    openedAt: num(r.opened_at),
    updatedAt: num(r.updated_at),
    removed: r.removed,
  });

export const toRow = (e: BoardEntry, userId: string) => ({
  user_id: userId,
  board_id: e.id,
  title: e.title,
  role: e.role,
  owner_key: e.ownerKey,
  view_only: e.viewOnly,
  password_protected: e.passwordProtected,
  created_at: e.createdAt,
  opened_at: e.openedAt,
  updated_at: e.updatedAt,
  removed: e.removed,
});

/** Two entries describe the same state (so nothing needs uploading). */
export const sameEntry = (a: BoardEntry, b: BoardEntry) =>
  a.id === b.id &&
  a.title === b.title &&
  a.role === b.role &&
  a.ownerKey === b.ownerKey &&
  a.viewOnly === b.viewOnly &&
  a.passwordProtected === b.passwordProtected &&
  a.createdAt === b.createdAt &&
  a.openedAt === b.openedAt &&
  a.updatedAt === b.updatedAt &&
  a.removed === b.removed;

/**
 * Which board this tab is showing, and how it may be used. All of it lives in the URL hash
 * (`#k3j9…`), so a board is just a link: no accounts, no server.
 *
 *   #<id>              anyone with this link can edit
 *   #<id>.view         view-only link (see the note below: a courtesy, not a lock)
 *   #<id>.pw           the board is password protected: asks for the password on open
 *   #<id>.pw.view      both
 *
 * The ID is the secret. New IDs are 128 random bits (22 characters), so they cannot be
 * guessed; boards made by earlier versions have shorter IDs and are less strong. The hash is
 * never sent to any server, and the signalling server only ever sees a SHA-256 of it (sync.ts).
 *
 * VIEW-ONLY IS ADVISORY. There is no server to check who may write: every peer holds the whole
 * document, so a determined person can edit their own copy and send it. View-only stops
 * accidental edits (and hides the editing tools); it does not stop a malicious viewer. Only
 * give an edit link to people you trust. The password is the real access control (it gates who
 * can connect at all).
 *
 * With no ID in the URL we reopen the board used last (with the same flags); only a
 * first-ever visit creates a new one.
 *
 * OWNERS. The browser that creates a board holds its owner key (owner.ts). An owner link
 *   #<id>.owner:<key>
 * hands that key to someone else. The key is moved into this browser's storage and removed
 * from the address bar straight away, and it is never part of the edit or view links.
 */
import { parse, stringify, type Flag, type Parsed } from './boardUrl';

const LAST_KEY = 'p2pwb:lastBoard';
const PW_PREFIX = 'p2pwb:pw:';
const OWNER_PREFIX = 'p2pwb:owner:'; // this browser's owner key for a board
const PIN_PREFIX = 'p2pwb:ownerpin:'; // the owner hash this browser trusts for a board
const CREATED_PREFIX = 'p2pwb:created:'; // this browser just made this board
const DELETED_PREFIX = 'p2pwb:deleted:'; // the owner deleted this board

export function randomBoardId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); // 128 bits
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage blocked: ignore */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

function resolve(): Parsed {
  let parsed = parse(location.hash);
  if (!parsed) {
    try {
      parsed = parse(localStorage.getItem(LAST_KEY) ?? '');
    } catch {
      /* storage blocked: fall through to a fresh board */
    }
  }
  if (!parsed) {
    parsed = { id: randomBoardId(), flags: new Set() };
    store.set(CREATED_PREFIX + parsed.id, '1'); // a brand-new board: this browser will own it
  }
  if (parsed.ownerKey) store.set(OWNER_PREFIX + parsed.id, parsed.ownerKey); // opened an owner link
  try {
    localStorage.setItem(LAST_KEY, stringify(parsed));
  } catch {
    /* ignore */
  }
  if (location.hash !== `#${stringify(parsed)}`) history.replaceState(null, '', `#${stringify(parsed)}`);
  return parsed;
}

const current = resolve();

export const boardId = current.id;
/** Opened from a view-only link: editing is switched off in this tab. */
export const readOnly = current.flags.has('view');
/** The board asks for a password before connecting to anyone. */
export const passwordProtected = current.flags.has('pw');

// The document is created once per page load for one board, so switching boards = reload.
window.addEventListener('hashchange', () => location.reload());

/** Open a fresh, empty board. The old one stays saved and reachable by its link. */
export function newBoard() {
  const id = randomBoardId();
  store.set(CREATED_PREFIX + id, '1'); // the creator becomes the owner (owner.ts)
  location.hash = id;
}

/** A shareable link to this board. */
export function shareLink(kind: 'edit' | 'view'): string {
  const flags = new Set<Flag>();
  if (passwordProtected) flags.add('pw');
  if (kind === 'view') flags.add('view');
  return `${location.origin}${location.pathname}${location.search}#${stringify({ id: boardId, flags })}`;
}

/* ---------- optional password (kept in this browser, never in the URL) ---------- */

/** Passwords use WebCrypto, which browsers only provide on https:// and localhost. */
export const passwordsSupported = typeof crypto !== 'undefined' && !!crypto.subtle;

export function getPassword(): string | null {
  try {
    return localStorage.getItem(PW_PREFIX + boardId);
  } catch {
    return null;
  }
}

/**
 * Set (or with null, remove) this board's password and reload with the matching link. Others
 * on the old link stay connected until they reload; then they are asked for the new password.
 */
export function setPassword(password: string | null) {
  try {
    if (password) localStorage.setItem(PW_PREFIX + boardId, password);
    else localStorage.removeItem(PW_PREFIX + boardId);
  } catch {
    /* ignore */
  }
  const flags = new Set(current.flags);
  if (password) flags.add('pw');
  else flags.delete('pw');
  const next = `#${stringify({ id: boardId, flags })}`;
  if (location.hash === next) location.reload();
  else location.hash = next; // the hashchange handler reloads
}

/* ---------- ownership (the rules live in ownership.ts / owner.ts) ---------- */

/** This browser made the board just now (so it should become its owner). */
export const wasCreatedHere = () => store.get(CREATED_PREFIX + boardId) === '1';
export const clearCreatedFlag = () => store.remove(CREATED_PREFIX + boardId);

/** The owner key this browser holds for the board, if any. */
export const getOwnerKey = () => store.get(OWNER_PREFIX + boardId);
export const setOwnerKey = (key: string) => store.set(OWNER_PREFIX + boardId, key);
/** The same for any board (the list of my boards restores keys from the account: registry.ts). */
export const getOwnerKeyFor = (id: string) => store.get(OWNER_PREFIX + id);
export const setOwnerKeyFor = (id: string, key: string) => store.set(OWNER_PREFIX + id, key);
export const removeOwnerKeyFor = (id: string) => store.remove(OWNER_PREFIX + id);

/** The owner hash this browser first saw for the board (trust on first use). */
export const getPinnedHash = () => store.get(PIN_PREFIX + boardId);
export const setPinnedHash = (hash: string) => store.set(PIN_PREFIX + boardId, hash);

/** A link that makes whoever opens it an owner. Treat it like a password. */
export function ownerLink(key: string): string {
  const flags = new Set<Flag>();
  if (passwordProtected) flags.add('pw');
  return `${location.origin}${location.pathname}${location.search}#${stringify({ id: boardId, flags, ownerKey: key }, true)}`;
}

/** The owner deleted this board: it never opens again on this device. */
export const isMarkedDeleted = () => store.get(DELETED_PREFIX + boardId) === '1';
export const markDeleted = () => store.set(DELETED_PREFIX + boardId, '1');

/**
 * Forget what this browser stores about the board outside its database: the saved password,
 * the "reopen last board" pointer, and (when `everything`) the owner key and trusted hash too.
 * Removing a copy keeps the owner key, so an owner can still rejoin later.
 */
export function forgetBoardKeys(everything: boolean) {
  store.remove(PW_PREFIX + boardId);
  store.remove(CREATED_PREFIX + boardId);
  if (parse(store.get(LAST_KEY) ?? '')?.id === boardId) store.remove(LAST_KEY);
  if (everything) {
    store.remove(OWNER_PREFIX + boardId);
    store.remove(PIN_PREFIX + boardId);
  }
}

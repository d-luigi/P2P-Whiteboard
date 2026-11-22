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
 */
const LAST_KEY = 'p2pwb:lastBoard';
const PW_PREFIX = 'p2pwb:pw:';
const VALID_ID = /^[A-Za-z0-9_-]{4,64}$/;
const FLAGS = ['pw', 'view'] as const; // canonical order in the URL
type Flag = (typeof FLAGS)[number];

export function randomBoardId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); // 128 bits
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface Parsed {
  id: string;
  flags: Set<Flag>;
}

function parse(fragment: string): Parsed | null {
  const [id, ...rest] = fragment.replace(/^#\/?/, '').split('.');
  if (!VALID_ID.test(id)) return null;
  return { id, flags: new Set(rest.filter((f): f is Flag => (FLAGS as readonly string[]).includes(f))) };
}

const stringify = (p: Parsed) => p.id + FLAGS.filter((f) => p.flags.has(f)).map((f) => `.${f}`).join('');

function resolve(): Parsed {
  let parsed = parse(location.hash);
  if (!parsed) {
    try {
      parsed = parse(localStorage.getItem(LAST_KEY) ?? '');
    } catch {
      /* storage blocked: fall through to a fresh board */
    }
  }
  if (!parsed) parsed = { id: randomBoardId(), flags: new Set() };
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
  location.hash = randomBoardId();
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

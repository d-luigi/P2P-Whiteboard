/**
 * Which board this tab is showing. The ID lives in the URL hash (`#k3j9x0a2bq41`), so a
 * board is just a link: no accounts, no server. Each board gets its own Y.Doc and its own
 * IndexedDB database (see docStore.ts).
 *
 * With no ID in the URL we reopen the board used last (so closing and reopening the
 * browser lands you back on your work); only a first-ever visit creates a new one.
 */
const LAST_KEY = 'p2pwb:lastBoard';
const VALID_ID = /^[A-Za-z0-9_-]{4,64}$/;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function randomBoardId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

function resolveBoardId(): string {
  const fromHash = location.hash.replace(/^#\/?/, '');
  let id: string | null = VALID_ID.test(fromHash) ? fromHash : null;
  if (!id) {
    try {
      const last = localStorage.getItem(LAST_KEY);
      if (last && VALID_ID.test(last)) id = last;
    } catch {
      /* storage blocked: fall through to a fresh board */
    }
  }
  if (!id) id = randomBoardId();
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* ignore */
  }
  if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
  return id;
}

export const boardId = resolveBoardId();

// The document is created once per page load for one board, so switching boards = reload.
window.addEventListener('hashchange', () => location.reload());

/** Open a fresh, empty board. The old one stays saved and reachable by its link. */
export function newBoard() {
  location.hash = randomBoardId();
}

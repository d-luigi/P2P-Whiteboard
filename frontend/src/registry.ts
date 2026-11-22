import { create } from 'zustand';
import { boardId, getOwnerKey, passwordProtected, readOnly, removeOwnerKeyFor, setOwnerKeyFor } from './board';
import { recheckOwnership, useOwner } from './owner';
import {
  entryFragment,
  mergeEntries,
  patchEntry,
  recordVisit,
  sanitizeList,
  visibleEntries,
  type BoardEntry,
} from './registryCore';

/**
 * MY BOARDS (browser side). Every board this browser opens is added to a list kept in
 * localStorage, so there is always a "my boards" list, with or without an account. Signed-in
 * users get the same list on every device because account.ts merges it with their account.
 * The rules for merging and editing the list are in registryCore.ts.
 *
 * The list holds the board's ID, so it is as sensitive as the links themselves, and for
 * boards you own it holds the owner key. See "Accounts" in the README.
 */
const KEY = 'p2pwb:registry:v1';

function load(): BoardEntry[] {
  try {
    return sanitizeList(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return [];
  }
}

export const useRegistry = create<{ entries: BoardEntry[] }>(() => ({ entries: load() }));

type Listener = () => void;
const listeners = new Set<Listener>();
/** Called when the list changes because of something the user did here (not when a sync wrote it). */
export const onLocalChange = (fn: Listener) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function persist(entries: BoardEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* storage blocked: the list lives for this tab only */
  }
}

/** Change the list. `fromSync` writes (the account's data arriving) don't trigger another sync. */
function commit(entries: BoardEntry[], fromSync = false) {
  if (entries === useRegistry.getState().entries) return;
  persist(entries);
  useRegistry.setState({ entries });
  if (!fromSync) listeners.forEach((fn) => fn());
}

const change = (fn: (list: BoardEntry[]) => BoardEntry[]) => commit(fn(useRegistry.getState().entries));

// Another tab changed the list.
window.addEventListener('storage', (e) => {
  if (e.key === KEY) useRegistry.setState({ entries: load() });
});

/* ---------- what the list screen can do ---------- */

export const renameBoard = (id: string, title: string) => change((l) => patchEntry(l, id, { title }, Date.now()));
export const removeFromList = (id: string) => change((l) => patchEntry(l, id, { removed: true }, Date.now()));
export const myBoards = (entries: BoardEntry[]) => visibleEntries(entries);
export const openEntry = (e: BoardEntry) => {
  location.hash = entryFragment(e);
};

/* ---------- used by account.ts ---------- */

/** Merge in what the account holds. Returns the merged list. */
export function mergeFromAccount(remote: BoardEntry[]): BoardEntry[] {
  const merged = mergeEntries(useRegistry.getState().entries, remote);
  const cur = useRegistry.getState().entries;
  const same = merged.length === cur.length && merged.every((m, i) => m === cur[i] || JSON.stringify(m) === JSON.stringify(cur[i]));
  if (!same) commit(merged, true);
  restoreOwnerKey();
  return merged;
}

/** Forget the list and the owner keys on this device (signing out). The boards themselves stay saved. */
export function clearForSignOut() {
  for (const e of useRegistry.getState().entries) if (e.ownerKey) removeOwnerKeyFor(e.id);
  commit([], true);
}

/* ---------- tracking the board that is open ---------- */

/** If the account knows the owner key for this board and this browser doesn't, take it. */
function restoreOwnerKey() {
  const entry = useRegistry.getState().entries.find((e) => e.id === boardId && !e.removed);
  if (entry?.ownerKey && !getOwnerKey()) {
    setOwnerKeyFor(boardId, entry.ownerKey);
    recheckOwnership();
  }
}

function track() {
  change((l) =>
    recordVisit(l, { id: boardId, viewOnly: readOnly, passwordProtected, ownerKey: getOwnerKey(), now: Date.now() }),
  );
  restoreOwnerKey();
}

track();

// Owning the board (claimed here, or an owner link opened) is remembered with its key.
useOwner.subscribe((s, prev) => {
  if (s.isOwner && !prev.isOwner) track();
  if (s.deleted && !prev.deleted) change((l) => patchEntry(l, boardId, { removed: true }, Date.now()));
});

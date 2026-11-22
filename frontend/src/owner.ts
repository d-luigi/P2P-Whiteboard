import { create } from 'zustand';
import { useDoc, ydoc, yMeta, wipeLocalBoard } from './docStore';
import { provider, useSync } from './sync';
import {
  boardId,
  clearCreatedFlag,
  forgetBoardKeys,
  getOwnerKey,
  getPinnedHash,
  isMarkedDeleted,
  markDeleted,
  newBoard,
  randomBoardId,
  readOnly,
  setOwnerKey,
  setPinnedHash,
  wasCreatedHere,
} from './board';
import { hashOwnerKey, isOwnerKey, isValidDeletion, resolveOwnerHash } from './ownership';

/**
 * WHO OWNS THIS BOARD, AND DELETING IT.
 *
 *  - The browser that creates a board makes an owner key, keeps it, and writes only its HASH
 *    into the shared document (`meta.ownerHash`). An owner link (board.ts) hands the key to
 *    someone else, who then owns the board too.
 *  - "Delete for everyone" writes a notice (`meta.deleted`) holding the key as proof. Every
 *    connected browser checks the proof against the owner hash it trusts (ownership.ts), then
 *    erases its own saved copy and shows "this board was deleted". The same happens to a
 *    browser that was offline, if it later syncs with someone who still has the notice.
 *  - "Remove from this device" erases only this browser's copy; anyone can do that.
 *
 * LIMITS, because there is no server: a device that was offline when the board was deleted
 * (and never meets anyone holding the notice) keeps its copy, and a modified browser could
 * ignore the notice. Like view-only links, this stops mistakes and casual misuse, not a
 * determined attacker.
 */
const META = 'meta'; // transaction origin for ownership changes (never undoable)

interface OwnerState {
  /** The owner hash this browser trusts for the board, once it has seen one. */
  ownerHash: string | null;
  /** This browser holds a key that matches it. */
  isOwner: boolean;
  /** The board was deleted by an owner. */
  deleted: boolean;
}

export const useOwner = create<OwnerState>(() => ({
  ownerHash: null,
  isOwner: false,
  deleted: isMarkedDeleted(),
}));

let graceMs = 0; // when this browser is the one deleting: how long to keep sharing the notice
let finishing = false;

/** The board is gone: stop everything, erase the local copy, show the deleted screen. */
async function finishDeletion() {
  if (finishing) return;
  finishing = true;
  markDeleted(); // before anything else: even if erasing fails, the board never reopens here
  useOwner.setState({ deleted: true });
  if (graceMs > 0) await new Promise((resolve) => window.setTimeout(resolve, graceMs));
  try {
    provider?.destroy();
  } catch {
    /* ignore */
  }
  await wipeLocalBoard();
  forgetBoardKeys(true);
}

/** Re-read the ownership facts from the document. Runs on every change to `meta`. */
function refresh() {
  const hash = resolveOwnerHash(getPinnedHash(), yMeta.get('ownerHash'));
  if (hash && getPinnedHash() !== hash) setPinnedHash(hash); // trust on first use
  useOwner.setState({ ownerHash: hash, isOwner: isOwnerKey(boardId, getOwnerKey(), hash) });
  if (isValidDeletion(boardId, hash, yMeta.get('deleted'))) void finishDeletion();
}

/** Look at the ownership facts again (e.g. after the account restored this board's owner key). */
export const recheckOwnership = () => refresh();

/**
 * Become the owner of a board that has none (new boards do this automatically; older boards
 * use "Claim ownership"). Returns false if it already has an owner or this tab is view-only.
 */
export function claimOwnership(): boolean {
  if (readOnly || isMarkedDeleted() || useOwner.getState().ownerHash) return false;
  // Still catching up with other people? They may already have an owner we haven't seen yet.
  const sync = useSync.getState();
  if (sync.webrtcPeers > 0 && !sync.synced) return false;
  const key = randomBoardId(); // 128 random bits, URL-safe
  const hash = hashOwnerKey(boardId, key);
  setOwnerKey(key);
  setPinnedHash(hash);
  ydoc.transact(() => yMeta.set('ownerHash', hash), META);
  refresh();
  return true;
}

/** Delete the board for everyone (owners only). The observer below does the rest. */
export function deleteBoardForEveryone() {
  const key = getOwnerKey();
  if (readOnly || !key || !useOwner.getState().isOwner) {
    throw new Error('Only an owner can delete this board.');
  }
  graceMs = 1500; // let the notice reach everyone connected before this copy is erased
  ydoc.transact(() => yMeta.set('deleted', { at: Date.now(), proof: key }), META);
  refresh();
}

/** Erase only this browser's copy and open a fresh board. Anyone can do this. */
export async function removeFromDevice() {
  try {
    provider?.destroy();
  } catch {
    /* ignore */
  }
  await wipeLocalBoard();
  forgetBoardKeys(false); // an owner keeps their key, so they can rejoin later
  newBoard();
}

/* ---------- wiring ---------- */

yMeta.observe(() => refresh());

// A board this browser just created: once its saved copy has loaded, become its owner.
const whenLoaded = (fn: () => void) => {
  if (useDoc.getState().status !== 'loading') {
    fn();
    return;
  }
  const unsubscribe = useDoc.subscribe((s) => {
    if (s.status === 'loading') return;
    unsubscribe();
    fn();
  });
};

whenLoaded(() => {
  refresh();
  if (wasCreatedHere()) {
    clearCreatedFlag();
    if (!useOwner.getState().ownerHash) claimOwnership();
  }
});

// A board deleted earlier: make sure nothing of it is left in this browser.
if (isMarkedDeleted()) void wipeLocalBoard();

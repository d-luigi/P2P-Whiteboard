import { sha256Hex } from './sha256';

/**
 * The rules for who owns a board and whether a delete notice is genuine. Pure functions.
 *
 *  - The creator's browser makes a random OWNER KEY and keeps it. The board's document only
 *    ever holds a HASH of that key, so reading the document does not reveal it.
 *  - An owner link carries the key: whoever opens it can prove they are an owner.
 *  - Deleting writes a notice containing the key as proof. A peer accepts it only if the proof
 *    hashes to the owner hash it trusts.
 *  - "Trust on first use": the first owner hash a browser sees for a board is remembered
 *    (pinned), and later changes to it in the document are ignored.
 *
 * There is no server, so all of this is enforced by honest browsers, not by a lock: a
 * modified client could ignore it (the same limit as view-only links, see board.ts).
 */
const HEX64 = /^[0-9a-f]{64}$/;

export const hashOwnerKey = (boardId: string, key: string) =>
  sha256Hex(`p2pwb:owner:v1:${boardId}:${key}`);

export const isHash = (v: unknown): v is string => typeof v === 'string' && HEX64.test(v);

/** The hash we trust: the one we pinned earlier, otherwise the one in the document. */
export function resolveOwnerHash(pinned: string | null, inDoc: unknown): string | null {
  if (isHash(pinned)) return pinned;
  return isHash(inDoc) ? inDoc : null;
}

export const isOwnerKey = (boardId: string, key: string | null, hash: string | null) =>
  !!key && !!hash && hashOwnerKey(boardId, key) === hash;

/** A delete notice is genuine only if its proof hashes to the owner hash we trust. */
export function isValidDeletion(boardId: string, hash: string | null, notice: unknown): boolean {
  if (!hash || !notice || typeof notice !== 'object') return false;
  const proof = (notice as { proof?: unknown }).proof;
  return (
    typeof proof === 'string' && proof.length >= 16 && proof.length <= 64 && hashOwnerKey(boardId, proof) === hash
  );
}

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { create } from 'zustand';
import { boardId, isMarkedDeleted, readOnly } from './board';
import { sanitizeShape } from './validate';
import type { Shape } from './types';

type Shapes = Record<string, Shape>;

/**
 * DOCUMENT STATE: a Yjs document is the single source of truth.
 *
 *   ydoc
 *    └─ "shapes": Y.Map<Y.Map>     shape id -> one Y.Map per shape (id, type, x, y, ...)
 *
 *  - Every edit goes through `ydoc.transact(..., LOCAL)`.
 *  - A Y.UndoManager tracks only LOCAL transactions, so undo reverts YOUR edits and
 *    never a peer's.
 *  - The zustand store below is a read-only mirror: Yjs observers update it, and the
 *    canvas renders from it. Nothing writes to `shapes` except those observers.
 *
 * Each field of a shape is its own Y.Map entry, so two peers editing different fields of
 * the same shape (one moves it, one recolours it) both win. `points` is stored as one
 * whole array: editing it replaces it (last writer wins).
 *
 * Persistence: y-indexeddb stores this board's document in the browser (one IndexedDB
 * database per board ID) and reloads it on the next visit. The canvas waits for it
 * (`status`) before first render. The WebRTC provider (sync.ts) attaches to the exported `ydoc`.
 */
// gc: false keeps deleted content in the document instead of discarding it. That is what lets
// undo/redo still work after a reload: undoing a delete has to bring the old content back.
// The cost is that deleted shapes and old values pile up, so the board is COMPACTED (garbage
// collected) when it has grown large: see "backup, size, compaction" below. Compacting drops
// the deleted content, and with it the saved undo history.
export const ydoc = new Y.Doc({ gc: false });
export const yShapes = ydoc.getMap<Y.Map<unknown>>('shapes');
/** Board-level facts that are not drawing: who owns it (a hash) and whether it was deleted. See owner.ts. */
export const yMeta = ydoc.getMap<unknown>('meta');

/** Transaction origin for edits made by this user (the only origin the undo manager tracks). */
const LOCAL = 'local';
/** Origin for loading saved state; never undoable. */
const LOAD = 'load';

/* ---------- shape <-> Y.Map ---------- */

function toYMap(shape: Shape): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(shape)) if (v !== undefined) m.set(k, v);
  return m;
}

const sameValue = (a: unknown, b: unknown) =>
  a === b ||
  (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]));

/** Write `patch` into a shape's Y.Map, touching only fields that actually change. */
function applyPatch(m: Y.Map<unknown>, patch: Partial<Shape>) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) {
      if (m.has(k)) m.delete(k);
    } else if (!sameValue(m.get(k), v)) {
      m.set(k, v);
    }
  }
}

/** Create the shape, or make the existing one match `shape` exactly (dropping stale fields). */
function upsert(shape: Shape) {
  const existing = yShapes.get(shape.id);
  if (!existing) {
    yShapes.set(shape.id, toYMap(shape));
    return;
  }
  const next = shape as unknown as Record<string, unknown>;
  for (const k of [...existing.keys()]) if (next[k] === undefined) existing.delete(k);
  applyPatch(existing, shape);
}

/** A shape as the canvas may draw it, or null if it is missing or malformed (peers are untrusted). */
function readShape(id: string): Shape | null {
  const m = yShapes.get(id);
  return m instanceof Y.Map ? sanitizeShape(m.toJSON()) : null;
}

function readAll(): Shapes {
  const out: Shapes = {};
  yShapes.forEach((_m, id) => {
    const shape = readShape(id);
    if (shape) out[id] = shape;
  });
  return out;
}

/* ---------- offline persistence (y-indexeddb, one database per board) ---------- */

/** Give up waiting for IndexedDB after this long and let the user draw (unsaved). */
const SYNC_TIMEOUT_MS = 5000;

// Saved by Phase 1/2 in localStorage; imported once into the first board that opens.
const LEGACY_STATE_KEY = 'p2pwb:ydoc:v1'; // whole Yjs document, base64
const LEGACY_JSON_KEY = 'p2pwb:shapes:v1'; // plain shapes JSON

function fromBase64(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Bring boards saved by earlier versions (localStorage) into this empty board. */
function importLegacy() {
  if (readOnly) return;
  try {
    const state = localStorage.getItem(LEGACY_STATE_KEY);
    const json = localStorage.getItem(LEGACY_JSON_KEY);
    if (state) {
      Y.applyUpdate(ydoc, fromBase64(state), LOAD);
    } else if (json) {
      const old = JSON.parse(json) as Shapes;
      ydoc.transact(() => {
        for (const s of Object.values(old)) if (s && typeof s.id === 'string') upsert(s);
      }, LOAD);
    }
    localStorage.removeItem(LEGACY_STATE_KEY);
    localStorage.removeItem(LEGACY_JSON_KEY);
  } catch {
    /* corrupt or blocked: just start empty */
  }
}

/**
 * 'loading'  waiting for the saved board to come out of IndexedDB (render nothing yet)
 * 'ready'    loaded; every change is saved automatically
 * 'memory'   IndexedDB is unavailable or too slow; the board works but will NOT be saved
 *            (if IndexedDB answers later, the saved content is merged in and this flips to 'ready')
 */
export type DocStatus = 'loading' | 'ready' | 'memory';

// Compaction writes a fresh database under a new "generation" name and then switches to it,
// so the old data stays intact until the new copy is safely stored.
const GEN_KEY = `p2pwb:gen:${boardId}`;
const generation = (() => {
  try {
    return localStorage.getItem(GEN_KEY) ?? '';
  } catch {
    return '';
  }
})();
const dbName = (gen: string) => `p2pwb:board:${boardId}${gen ? `:${gen}` : ''}`;

let persistence: IndexeddbPersistence | null = null;
try {
  if (!isMarkedDeleted() && typeof indexedDB !== 'undefined') {
    persistence = new IndexeddbPersistence(dbName(generation), ydoc);
  }
} catch {
  persistence = null; // e.g. blocked in a private window
}

/* ---------- undo / redo ---------- */

/**
 * We decide where one undo step ends (see startsNewStep), so Yjs's own time-based
 * merging is effectively disabled and `stopCapturing()` marks each boundary.
 */
const undoManager = new Y.UndoManager(yShapes, {
  trackedOrigins: new Set([LOCAL]),
  captureTimeout: Number.MAX_SAFE_INTEGER,
});

/**
 * Undo/redo survives a reload. Each undo step is just two sets of Yjs item ranges (what the
 * step inserted, what it deleted), so we save those, per board, in localStorage and put them
 * back once the board has loaded from IndexedDB.
 */
type Ranges = [client: number, ranges: [clock: number, len: number][]][];
type DSLike = { clients: Map<number, { clock: number; len: number }[]> };
type StepLike = { insertions: DSLike; deletions: DSLike; meta: Map<unknown, unknown> };
type SavedStep = { i: Ranges; d: Ranges };

const UNDO_KEY = `p2pwb:undo:${boardId}`;
const MAX_SAVED_STEPS = 200;
let undoReady = false; // don't save until the saved stacks have been restored

const toRanges = (ds: DSLike): Ranges =>
  [...ds.clients].map(([c, items]) => [c, items.map((r): [number, number] => [r.clock, r.len])]);

const serializeStack = (stack: unknown[]): SavedStep[] =>
  (stack as StepLike[]).slice(-MAX_SAVED_STEPS).map((s) => ({
    i: toRanges(s.insertions),
    d: toRanges(s.deletions),
  }));

function saveUndo() {
  if (!undoReady) return;
  try {
    localStorage.setItem(
      UNDO_KEY,
      JSON.stringify({
        u: serializeStack(undoManager.undoStack),
        r: serializeStack(undoManager.redoStack),
      }),
    );
  } catch {
    /* storage full or blocked: undo just won't survive a reload */
  }
}

/** Rebuild a delete set, dropping any range the loaded document doesn't contain. */
function fromRanges(raw: unknown, have: Map<number, number>): DSLike {
  const ds: DSLike = { clients: new Map() };
  if (!Array.isArray(raw)) return ds;
  for (const entry of raw) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'number' || !Array.isArray(entry[1])) continue;
    const kept: { clock: number; len: number }[] = [];
    for (const r of entry[1]) {
      if (!Array.isArray(r) || !Number.isFinite(r[0]) || !Number.isFinite(r[1])) continue;
      if ((have.get(entry[0]) ?? 0) >= r[0] + r[1]) kept.push({ clock: r[0], len: r[1] });
    }
    if (kept.length > 0) ds.clients.set(entry[0], kept);
  }
  return ds;
}

function restoreUndo() {
  try {
    // Only into an untouched manager (the board may have been edited in memory mode already).
    if (undoManager.undoStack.length === 0 && undoManager.redoStack.length === 0) {
      const raw = localStorage.getItem(UNDO_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { u?: SavedStep[]; r?: SavedStep[] };
        const have = Y.decodeStateVector(Y.encodeStateVector(ydoc));
        const rebuild = (steps: unknown): StepLike[] =>
          (Array.isArray(steps) ? (steps as SavedStep[]) : [])
            .map((s) => ({
              insertions: fromRanges(s?.i, have),
              deletions: fromRanges(s?.d, have),
              meta: new Map<unknown, unknown>(),
            }))
            .filter((s) => s.insertions.clients.size > 0 || s.deletions.clients.size > 0);
        (undoManager.undoStack as unknown[]).push(...rebuild(saved.u));
        (undoManager.redoStack as unknown[]).push(...rebuild(saved.r));
      }
    }
  } catch {
    /* corrupt saved history: start with an empty one */
  }
  undoReady = true;
  syncUndoFlags();
}

let undoSaveTimer = 0;
const scheduleUndoSave = () => {
  clearTimeout(undoSaveTimer);
  undoSaveTimer = window.setTimeout(saveUndo, 300);
};

const COALESCE_MS = 800;
let batchOpen = false;
let batchPushed = false;
let lastKey: string | null = null;
let lastAt = 0;

/** Should this change start a new undo step? */
function startsNewStep(coalesceKey?: string): boolean {
  const now = Date.now();
  let push = true;
  if (batchOpen) {
    push = !batchPushed;
    batchPushed = true;
    lastKey = null;
  } else {
    if (coalesceKey && coalesceKey === lastKey && now - lastAt < COALESCE_MS) push = false;
    lastKey = coalesceKey ?? null;
  }
  lastAt = now;
  return push;
}

/** Run `fn` as one Yjs transaction, and as a new or merged undo step. */
function run(fn: () => void, coalesceKey?: string) {
  if (readOnly) return; // view-only: no edits (see board.ts)
  if (startsNewStep(coalesceKey)) undoManager.stopCapturing();
  ydoc.transact(fn, LOCAL);
}

/* ---------- the store the UI uses ---------- */

interface DocState {
  /** Read-only mirror of the Yjs document, kept fresh by the observers below. */
  shapes: Shapes;
  status: DocStatus;
  canUndo: boolean;
  canRedo: boolean;
  addShape: (shape: Shape) => void;
  /** coalesceKey: repeated updates with the same key within 0.8s become ONE undo step. */
  updateShape: (id: string, patch: Partial<Shape>, coalesceKey?: string) => void;
  /** Patch several shapes as ONE change (group move / restyle / reorder). */
  updateShapes: (patches: Record<string, Partial<Shape>>, coalesceKey?: string) => void;
  deleteShapes: (ids: string[]) => void;
  /** Remove some shapes and add/overwrite others as ONE change (used by the partial eraser). */
  replaceShapes: (removeIds: string[], upsertShapes: Shape[]) => void;
  /** Everything between beginBatch() and endBatch() becomes ONE undo step. */
  beginBatch: () => void;
  endBatch: () => void;
  undo: () => void;
  redo: () => void;
}

export const useDoc = create<DocState>(() => ({
  shapes: readAll(),
  status: persistence ? 'loading' : 'memory',
  canUndo: undoManager.undoStack.length > 0,
  canRedo: undoManager.redoStack.length > 0,

  addShape: (shape) => run(() => upsert(shape)),

  updateShape: (id, patch, key) => {
    const m = yShapes.get(id);
    if (m) run(() => applyPatch(m, patch), key);
  },

  updateShapes: (patches, key) => {
    const ids = Object.keys(patches).filter((id) => yShapes.has(id));
    if (ids.length === 0) return;
    run(() => {
      for (const id of ids) applyPatch(yShapes.get(id)!, patches[id]);
    }, key);
  },

  deleteShapes: (ids) => {
    const present = ids.filter((id) => yShapes.has(id));
    if (present.length === 0) return;
    run(() => present.forEach((id) => yShapes.delete(id)));
  },

  replaceShapes: (removeIds, upsertShapes) => {
    const present = removeIds.filter((id) => yShapes.has(id));
    if (present.length === 0 && upsertShapes.length === 0) return;
    run(() => {
      present.forEach((id) => yShapes.delete(id));
      upsertShapes.forEach(upsert);
    });
  },

  beginBatch: () => {
    batchOpen = true;
    batchPushed = false;
  },
  endBatch: () => {
    batchOpen = false;
    batchPushed = false;
  },

  undo: () => {
    if (readOnly) return;
    undoManager.undo();
    undoManager.stopCapturing(); // the next edit must not merge into the step we just popped
    lastKey = null;
  },
  redo: () => {
    if (readOnly) return;
    undoManager.redo();
    undoManager.stopCapturing();
    lastKey = null;
  },
}));

/* ---------- Yjs -> store (this is what the canvas renders from) ---------- */

// Fires for local edits, undo/redo, loading, and (Phase 3) remote peers alike. Only the
// shapes that changed are re-read, so unchanged shapes keep their object identity.
yShapes.observeDeep((events) => {
  const touched = new Set<string>();
  for (const ev of events) {
    if (ev.target === yShapes) {
      (ev as Y.YMapEvent<Y.Map<unknown>>).keysChanged.forEach((k) => touched.add(k));
    } else {
      const target = ev.target as Y.Map<unknown>;
      const id = target instanceof Y.Map ? target.get('id') : undefined; // a single shape's field changed
      if (typeof id === 'string') touched.add(id);
    }
  }
  const next = { ...useDoc.getState().shapes };
  for (const id of touched) {
    const shape = readShape(id);
    if (shape) next[id] = shape;
    else delete next[id]; // gone, or malformed (never reaches the canvas)
  }
  useDoc.setState({ shapes: next });
});

const syncUndoFlags = () =>
  useDoc.setState({
    canUndo: undoManager.undoStack.length > 0,
    canRedo: undoManager.redoStack.length > 0,
  });
undoManager.on('stack-item-added', syncUndoFlags);
undoManager.on('stack-item-popped', syncUndoFlags);
undoManager.on('stack-cleared', syncUndoFlags);
for (const ev of ['stack-item-added', 'stack-item-updated', 'stack-item-popped', 'stack-cleared'] as const) {
  undoManager.on(ev, scheduleUndoSave);
}
window.addEventListener('pagehide', saveUndo);

/* ---------- backup, size, compaction ---------- */

export interface BoardStats {
  shapes: number;
  /** Size of the whole saved document, including deleted content not yet compacted. */
  bytes: number;
}

export function boardStats(): BoardStats {
  return {
    shapes: Object.keys(useDoc.getState().shapes).length,
    bytes: Y.encodeStateAsUpdate(ydoc).byteLength,
  };
}

/** The whole board as one binary snapshot (a Yjs update). Import it into any board to merge it in. */
export function exportBackup(): Uint8Array {
  return Y.encodeStateAsUpdate(ydoc);
}

/** Merge a backup into this board as ONE undo step. Returns how many shapes it contained. */
export function importBackup(bytes: Uint8Array): number {
  if (readOnly) throw new Error('This board is view-only.');
  const probe = new Y.Doc();
  let count = 0;
  try {
    Y.applyUpdate(probe, bytes);
    probe.getMap<Y.Map<unknown>>('shapes').forEach((m) => {
      if (m instanceof Y.Map && sanitizeShape(m.toJSON())) count++;
    });
  } catch {
    throw new Error('That file is not a whiteboard backup.');
  } finally {
    probe.destroy();
  }
  if (count === 0) throw new Error('That backup has no shapes in it.');
  undoManager.stopCapturing();
  // A backup carries the OTHER board's ownership marks. Never let them replace this board's.
  const keep = { ownerHash: yMeta.get('ownerHash'), deleted: yMeta.get('deleted') };
  ydoc.transact(() => Y.applyUpdate(ydoc, bytes), LOCAL);
  ydoc.transact(() => {
    for (const [k, v] of Object.entries(keep)) {
      if (yMeta.get(k) === v) continue;
      if (v === undefined) yMeta.delete(k);
      else yMeta.set(k, v);
    }
  }, LOAD);
  undoManager.stopCapturing();
  return count;
}

/** Add many shapes at once, not undoable. For the dev stress test (stress.ts) only. */
export function bulkAddShapes(shapes: Shape[]) {
  ydoc.transact(() => shapes.forEach(upsert), LOAD);
}

const COMPACT_MIN_BYTES = 4 * 1024 * 1024; // don't bother below this size
const COMPACT_MIN_SAVING = 0.5; // ...and only if at least half of it is garbage
const COMPACT_TRIED_KEY = `p2pwb:compactTried:${boardId}`; // per tab session: never loops
export const NOTICE_KEY = 'p2pwb:notice'; // shown once as a toast after the reload

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/** Re-encode the board through a garbage-collecting document: same shapes, no deleted content. */
function measureCompact() {
  const full = Y.encodeStateAsUpdate(ydoc);
  const fresh = new Y.Doc({ gc: true });
  Y.applyUpdate(fresh, full);
  const compact = Y.encodeStateAsUpdate(fresh);
  fresh.destroy();
  return { full: full.byteLength, compact };
}

/**
 * Garbage-collect this board: save the compacted copy to a new database, switch to it and
 * reload. Deleted content is gone afterwards, and so is the saved undo history (it refers to
 * that content). The old database is only removed after the new one is safely written.
 */
async function writeCompactAndReload(compact: Uint8Array, before: number) {
  if (!persistence) throw new Error('This browser is not saving the board, so there is nothing to compact.');
  const tmp = new Y.Doc({ gc: true });
  Y.applyUpdate(tmp, compact);
  const gen = Date.now().toString(36);
  const next = new IndexeddbPersistence(dbName(gen), tmp); // stores the doc's state when it opens
  await next.whenSynced;
  await next.destroy();
  tmp.destroy();
  try {
    localStorage.setItem(GEN_KEY, gen);
    localStorage.removeItem(UNDO_KEY);
    sessionStorage.setItem(NOTICE_KEY, `Board compacted: ${mb(before)} → ${mb(compact.byteLength)}. Undo history was reset.`);
  } catch {
    /* ignore */
  }
  indexedDB.deleteDatabase(dbName(generation)); // best effort: waits until this page has reloaded
  location.reload();
}

/** Manual "Compact board" (BoardMenu). Resolves only if it could not reload. */
export async function compactBoard() {
  if (readOnly) throw new Error('This board is view-only.');
  const { full, compact } = measureCompact();
  await writeCompactAndReload(compact, full);
}

/** On load: compact automatically when the board is big and mostly garbage. True = reloading. */
async function maybeAutoCompact(): Promise<boolean> {
  if (readOnly || !persistence) return false;
  try {
    if (sessionStorage.getItem(COMPACT_TRIED_KEY)) return false;
    const size = Y.encodeStateAsUpdate(ydoc).byteLength;
    if (size < COMPACT_MIN_BYTES) return false;
    const { full, compact } = measureCompact();
    if (compact.byteLength > full * (1 - COMPACT_MIN_SAVING)) return false;
    sessionStorage.setItem(COMPACT_TRIED_KEY, '1');
    await writeCompactAndReload(compact, full);
    return true;
  } catch (err) {
    console.error('Automatic compaction failed; continuing with the existing data', err);
    return false;
  }
}

/* ---------- loading gate ---------- */

if (persistence) {
  // y-indexeddb applies the saved updates to `ydoc` first, then fires "synced". The
  // observer above has already mirrored them into the store by the time we mark ready.
  persistence.whenSynced
    .then(async () => {
      if (yShapes.size === 0) importLegacy(); // brand-new board: adopt pre-Phase-3 data once
      if (await maybeAutoCompact()) return; // reloading: stay on the loading screen
      restoreUndo(); // bring back this board's saved undo / redo history
      useDoc.setState({ status: 'ready' });
    })
    .catch((err) => {
      console.error('Loading the saved board failed', err);
      restoreUndo();
      useDoc.setState({ status: 'memory' });
    });
  window.setTimeout(() => {
    if (useDoc.getState().status === 'loading') useDoc.setState({ status: 'memory' });
  }, SYNC_TIMEOUT_MS);
}

/* ---------- erasing the local copy ---------- */

/**
 * Erase everything this browser saved for this board: its IndexedDB database, the saved undo
 * history and the compaction markers. Used when a board is deleted or removed from this device.
 */
export async function wipeLocalBoard() {
  undoReady = false; // stop the undo history being written back when the page is hidden
  try {
    if (persistence) await persistence.clearData();
    else if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase(dbName(generation));
  } catch (err) {
    console.error('Could not erase the saved board', err);
  }
  persistence = null;
  try {
    localStorage.removeItem(UNDO_KEY);
    localStorage.removeItem(GEN_KEY);
    sessionStorage.removeItem(COMPACT_TRIED_KEY);
  } catch {
    /* ignore */
  }
}

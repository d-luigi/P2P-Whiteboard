import { create } from 'zustand';
import type { Shape } from './types';

type Shapes = Record<string, Shape>;

/**
 * DOCUMENT STATE: everything here is what will be shared between peers.
 *
 * In Phase 2 this file is the ONLY thing we replace: `shapes` becomes a
 * Y.Map<Y.Map> inside a Y.Doc, and the undo/redo history below is replaced by
 * Y.UndoManager (which undoes only YOUR changes, not other peers' edits).
 */
interface DocState {
  shapes: Shapes;
  past: Shapes[]; // undo stack (snapshots)
  future: Shapes[]; // redo stack
  addShape: (shape: Shape) => void;
  /** coalesceKey: repeated updates with the same key within 0.8s become ONE undo step. */
  updateShape: (id: string, patch: Partial<Shape>, coalesceKey?: string) => void;
  deleteShapes: (ids: string[]) => void;
  /** Remove some shapes and add/overwrite others as ONE change (used by the partial eraser). */
  replaceShapes: (removeIds: string[], upsert: Shape[]) => void;
  /** Everything between beginBatch() and endBatch() becomes ONE undo step. */
  beginBatch: () => void;
  endBatch: () => void;
  undo: () => void;
  redo: () => void;
}

const MAX_HISTORY = 100;
const COALESCE_MS = 800;

// History bookkeeping. Not React state: nothing needs to re-render when these change.
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

export const useDoc = create<DocState>((set) => {
  const commit = (state: DocState, next: Shapes, key?: string) => ({
    shapes: next,
    past: startsNewStep(key) ? [...state.past, state.shapes].slice(-MAX_HISTORY) : state.past,
    future: [] as Shapes[],
  });

  return {
    shapes: {},
    past: [],
    future: [],

    addShape: (shape) =>
      set((s) => commit(s, { ...s.shapes, [shape.id]: shape })),

    updateShape: (id, patch, key) =>
      set((s) => {
        const old = s.shapes[id];
        if (!old) return s;
        return commit(s, { ...s.shapes, [id]: { ...old, ...patch } as Shape }, key);
      }),

    deleteShapes: (ids) =>
      set((s) => {
        const next = { ...s.shapes };
        let changed = false;
        for (const id of ids) {
          if (id in next) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? commit(s, next) : s;
      }),

    replaceShapes: (removeIds, upsert) =>
      set((s) => {
        const next = { ...s.shapes };
        let changed = false;
        for (const id of removeIds) {
          if (id in next) {
            delete next[id];
            changed = true;
          }
        }
        for (const shape of upsert) {
          next[shape.id] = shape;
          changed = true;
        }
        return changed ? commit(s, next) : s;
      }),

    beginBatch: () => {
      batchOpen = true;
      batchPushed = false;
    },
    endBatch: () => {
      batchOpen = false;
      batchPushed = false;
    },

    undo: () =>
      set((s) => {
        const prev = s.past[s.past.length - 1];
        if (!prev) return s;
        lastKey = null;
        return { shapes: prev, past: s.past.slice(0, -1), future: [s.shapes, ...s.future] };
      }),

    redo: () =>
      set((s) => {
        const next = s.future[0];
        if (!next) return s;
        lastKey = null;
        return { shapes: next, past: [...s.past, s.shapes], future: s.future.slice(1) };
      }),
  };
});

import { create } from 'zustand';
import { useDoc } from './docStore';
import { boardId, readOnly } from './board';
import type { EraserMode, MarqueeMode, Shape, Style, Tool, View } from './types';

/**
 * UI STATE: local to this user and never synced (current tool, selection,
 * colours, sizes, camera). Keeping it separate from docStore is what makes the
 * Yjs document (docStore.ts) a self-contained module.
 */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

/** A camera that puts world point (wx, wy) in the middle of the screen. */
export const centredView = (wx = 0, wy = 0, scale = 1): View => ({
  scale,
  x: window.innerWidth / 2 - wx * scale,
  y: window.innerHeight / 2 - wy * scale,
});

// At most one "fly to" animation runs at a time; any manual pan/zoom cancels it.
let flightFrame = 0;
const stopFlight = () => {
  if (flightFrame) cancelAnimationFrame(flightFrame);
  flightFrame = 0;
};
const FLIGHT_MS = 350;

/**
 * The camera is remembered per board in localStorage, as the world point at the screen
 * centre plus the zoom (not raw pixel offsets), so reopening at a different window size
 * still lands on the same spot. Local to this browser; never synced to peers.
 */
const VIEW_KEY = `p2pwb:view:${boardId}`;

function loadView(): View {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) {
      const v = JSON.parse(raw) as { cx?: unknown; cy?: unknown; scale?: unknown };
      if (
        typeof v.cx === 'number' && Number.isFinite(v.cx) &&
        typeof v.cy === 'number' && Number.isFinite(v.cy) &&
        typeof v.scale === 'number' && Number.isFinite(v.scale)
      ) {
        return centredView(v.cx, v.cy, Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale)));
      }
    }
  } catch {
    /* storage blocked or corrupt value: fall back to the origin */
  }
  return centredView();
}

function saveView(view: View) {
  try {
    localStorage.setItem(
      VIEW_KEY,
      JSON.stringify({
        cx: (window.innerWidth / 2 - view.x) / view.scale,
        cy: (window.innerHeight / 2 - view.y) / view.scale,
        scale: view.scale,
      }),
    );
  } catch {
    /* ignore */
  }
}

interface UIState {
  tool: Tool;
  selectedIds: string[]; // one or many shapes (the Selection tool can pick several)
  style: Style;
  eraserSize: number; // diameter in screen pixels
  eraserMode: EraserMode;
  marqueeMode: MarqueeMode;
  editRequest: string | null; // id of a text shape the Board should open the editor for
  view: View;
  /** Awareness id of the peer whose camera we are following, or null. */
  followId: number | null;
  helpOpen: boolean; // keyboard shortcuts dialog
  setHelp: (open: boolean) => void;
  /** Which delete confirmation is open: for everyone (owners) or just this device. */
  deleteDialog: 'everyone' | 'local' | null;
  setDeleteDialog: (mode: 'everyone' | 'local' | null) => void;
  setFollow: (id: number | null) => void;
  setTool: (tool: Tool) => void;
  setSelected: (id: string | null) => void;
  setSelection: (ids: string[]) => void;
  setStyle: (patch: Partial<Style>) => void;
  setEraserSize: (size: number) => void;
  setEraserMode: (mode: EraserMode) => void;
  setMarqueeMode: (mode: MarqueeMode) => void;
  requestEdit: (id: string | null) => void;
  setView: (view: View) => void;
  zoomAt: (px: number, py: number, factor: number) => void;
  resetView: () => void;
  /** Fly the camera so world point (wx, wy) is at the screen centre. */
  centerOn: (wx: number, wy: number, scale?: number) => void;
  /** Back to the world origin (0, 0), centred on screen. */
  goHome: () => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  bringToFront: () => void;
  sendToBack: () => void;
  nudgeSelected: (dx: number, dy: number) => void;
}

/** The selected shapes that still exist. */
const selectedShapes = (ids: string[]): Shape[] => {
  const all = useDoc.getState().shapes;
  return ids.map((id) => all[id]).filter((s): s is Shape => !!s);
};

export const useUI = create<UIState>((set, get) => ({
  tool: readOnly ? 'hand' : 'select',
  helpOpen: false,
  setHelp: (helpOpen) => set({ helpOpen }),
  deleteDialog: null,
  setDeleteDialog: (deleteDialog) => set({ deleteDialog }),
  selectedIds: [],
  style: { stroke: '#1f2430', fill: 'transparent', strokeWidth: 4 },
  eraserSize: 24,
  eraserMode: 'partial',
  marqueeMode: 'rect',
  editRequest: null,
  followId: null,
  view: loadView(), // last position on this board, or the origin (0, 0) if none saved

  // Selection and movement tools keep a selection alive.
  setTool: (tool) => {
    // A view-only tab can look around and point, nothing else.
    if (readOnly && tool !== 'hand' && tool !== 'laser') return;
    set((s) => ({
      tool,
      selectedIds: tool === 'select' || tool === 'marquee' || tool === 'move' ? s.selectedIds : [],
    }));
  },

  setSelected: (id) => set({ selectedIds: id ? [id] : [] }),
  setSelection: (selectedIds) => set({ selectedIds }),

  // Changing a style also restyles every selected shape.
  setStyle: (patch) => {
    set((s) => ({ style: { ...s.style, ...patch } }));
    const ids = get().selectedIds;
    const patches: Record<string, Partial<Shape>> = {};
    for (const shape of selectedShapes(ids)) {
      const update: Record<string, unknown> = {};
      if (patch.stroke !== undefined) update.stroke = patch.stroke;
      if (patch.strokeWidth !== undefined) update.strokeWidth = patch.strokeWidth;
      if (patch.fill !== undefined && (shape.type === 'rect' || shape.type === 'ellipse')) {
        update.fill = patch.fill;
      }
      if (Object.keys(update).length > 0) patches[shape.id] = update as Partial<Shape>;
    }
    if (Object.keys(patches).length > 0) {
      // Colour pickers fire continuously: coalesce so one drag = one undo step.
      useDoc.getState().updateShapes(patches, `style:${ids.join(',')}`);
    }
  },

  setEraserSize: (eraserSize) => set({ eraserSize }),
  setEraserMode: (eraserMode) => set({ eraserMode }),
  setMarqueeMode: (marqueeMode) => set({ marqueeMode }),
  requestEdit: (editRequest) => set({ editRequest }),

  setView: (view) => {
    stopFlight();
    set({ view, followId: null }); // moving the camera yourself ends follow mode
  },

  setFollow: (followId) => {
    if (followId !== null) stopFlight();
    set({ followId });
  },

  // Zoom keeping the world point under (px, py) fixed on screen.
  zoomAt: (px, py, factor) => {
    stopFlight();
    set((s) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s.view.scale * factor));
      const wx = (px - s.view.x) / s.view.scale;
      const wy = (py - s.view.y) / s.view.scale;
      return { followId: null, view: { scale, x: px - wx * scale, y: py - wy * scale } };
    });
  },

  resetView: () => get().centerOn(0, 0, 1),

  centerOn: (wx, wy, scale) => {
    stopFlight();
    set({ followId: null });
    const from = get().view;
    const to = centredView(wx, wy, scale ?? from.scale);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      set({ view: to });
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / FLIGHT_MS);
      const e = 1 - Math.pow(1 - t, 3); // ease-out
      set({
        view: {
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
          scale: from.scale + (to.scale - from.scale) * e,
        },
      });
      flightFrame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    flightFrame = requestAnimationFrame(step);
  },

  goHome: () => get().centerOn(0, 0),

  deleteSelected: () => {
    const ids = get().selectedIds;
    if (ids.length === 0) return;
    useDoc.getState().deleteShapes(ids);
    set({ selectedIds: [] });
  },

  duplicateSelected: () => {
    const shapes = selectedShapes(get().selectedIds).sort((a, b) => a.z - b.z);
    if (shapes.length === 0) return;
    const now = Date.now();
    const copies: Shape[] = shapes.map((shape, i) => ({
      ...shape,
      id: crypto.randomUUID(),
      z: now + i,
      x: shape.x + 20,
      y: shape.y + 20,
    }));
    const doc = useDoc.getState();
    doc.beginBatch(); // one undo step for the whole group
    copies.forEach((c) => doc.addShape(c));
    doc.endBatch();
    set({ selectedIds: copies.map((c) => c.id) });
  },

  // Keeps the selected shapes' relative stacking order.
  bringToFront: () => {
    const shapes = selectedShapes(get().selectedIds).sort((a, b) => a.z - b.z);
    if (shapes.length === 0) return;
    const now = Date.now();
    const patches: Record<string, Partial<Shape>> = {};
    shapes.forEach((s, i) => (patches[s.id] = { z: now + i }));
    useDoc.getState().updateShapes(patches);
  },

  sendToBack: () => {
    const shapes = selectedShapes(get().selectedIds).sort((a, b) => a.z - b.z);
    if (shapes.length === 0) return;
    const lowest = Math.min(...Object.values(useDoc.getState().shapes).map((s) => s.z));
    const patches: Record<string, Partial<Shape>> = {};
    shapes.forEach((s, i) => (patches[s.id] = { z: lowest - shapes.length + i }));
    useDoc.getState().updateShapes(patches);
  },

  // Repeated arrow-key taps coalesce into one undo step.
  nudgeSelected: (dx, dy) => {
    const ids = get().selectedIds;
    const patches: Record<string, Partial<Shape>> = {};
    for (const s of selectedShapes(ids)) patches[s.id] = { x: s.x + dx, y: s.y + dy };
    if (Object.keys(patches).length > 0) {
      useDoc.getState().updateShapes(patches, `nudge:${ids.join(',')}`);
    }
  },
}));

// Save the camera shortly after it stops moving, and once more when the tab is closed or hidden.
let saveTimer = 0;
useUI.subscribe((state, prev) => {
  if (state.view === prev.view) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveView(useUI.getState().view), 300);
});
window.addEventListener('pagehide', () => saveView(useUI.getState().view));

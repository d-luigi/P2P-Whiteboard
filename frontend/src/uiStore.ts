import { create } from 'zustand';
import { useDoc } from './docStore';
import type { EraserMode, Shape, Style, Tool, View } from './types';

/**
 * UI STATE: local to this user and never synced (current tool, selection,
 * colours, sizes, camera). Keeping it separate from docStore is what makes the
 * Yjs swap in Phase 2 painless.
 */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

interface UIState {
  tool: Tool;
  selectedId: string | null;
  style: Style;
  eraserSize: number; // diameter in screen pixels
  eraserMode: EraserMode;
  view: View;
  setTool: (tool: Tool) => void;
  setSelected: (id: string | null) => void;
  setStyle: (patch: Partial<Style>) => void;
  setEraserSize: (size: number) => void;
  setEraserMode: (mode: EraserMode) => void;
  setView: (view: View) => void;
  zoomAt: (px: number, py: number, factor: number) => void;
  resetView: () => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  bringToFront: () => void;
  sendToBack: () => void;
  nudgeSelected: (dx: number, dy: number) => void;
}

const selectedShape = (id: string | null): Shape | undefined =>
  id ? useDoc.getState().shapes[id] : undefined;

export const useUI = create<UIState>((set, get) => ({
  tool: 'select',
  selectedId: null,
  style: { stroke: '#1f2430', fill: 'transparent', strokeWidth: 4 },
  eraserSize: 24,
  eraserMode: 'partial',
  view: { x: 0, y: 0, scale: 1 },

  setTool: (tool) =>
    set((s) => ({ tool, selectedId: tool === 'select' ? s.selectedId : null })),

  setSelected: (id) => set({ selectedId: id }),

  // Changing a style also restyles the selected shape.
  setStyle: (patch) => {
    set((s) => ({ style: { ...s.style, ...patch } }));
    const id = get().selectedId;
    const shape = selectedShape(id);
    if (!id || !shape) return;
    const update: Record<string, unknown> = {};
    if (patch.stroke !== undefined) update.stroke = patch.stroke;
    if (patch.strokeWidth !== undefined) update.strokeWidth = patch.strokeWidth;
    if (patch.fill !== undefined && (shape.type === 'rect' || shape.type === 'ellipse')) {
      update.fill = patch.fill;
    }
    if (Object.keys(update).length > 0) {
      // Colour pickers fire continuously: coalesce so one drag = one undo step.
      useDoc.getState().updateShape(id, update as Partial<Shape>, `style:${id}`);
    }
  },

  setEraserSize: (eraserSize) => set({ eraserSize }),

  setEraserMode: (eraserMode) => set({ eraserMode }),

  setView: (view) => set({ view }),

  // Zoom keeping the world point under (px, py) fixed on screen.
  zoomAt: (px, py, factor) =>
    set((s) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s.view.scale * factor));
      const wx = (px - s.view.x) / s.view.scale;
      const wy = (py - s.view.y) / s.view.scale;
      return { view: { scale, x: px - wx * scale, y: py - wy * scale } };
    }),

  resetView: () => set({ view: { x: 0, y: 0, scale: 1 } }),

  deleteSelected: () => {
    const id = get().selectedId;
    if (!id) return;
    useDoc.getState().deleteShapes([id]);
    set({ selectedId: null });
  },

  duplicateSelected: () => {
    const shape = selectedShape(get().selectedId);
    if (!shape) return;
    const copy: Shape = {
      ...shape,
      id: crypto.randomUUID(),
      z: Date.now(),
      x: shape.x + 20,
      y: shape.y + 20,
    };
    useDoc.getState().addShape(copy);
    set({ selectedId: copy.id });
  },

  bringToFront: () => {
    const id = get().selectedId;
    if (id && selectedShape(id)) useDoc.getState().updateShape(id, { z: Date.now() });
  },

  sendToBack: () => {
    const id = get().selectedId;
    if (!id || !selectedShape(id)) return;
    const lowest = Math.min(...Object.values(useDoc.getState().shapes).map((s) => s.z));
    useDoc.getState().updateShape(id, { z: lowest - 1 });
  },

  // Repeated arrow-key taps coalesce into one undo step.
  nudgeSelected: (dx, dy) => {
    const id = get().selectedId;
    const shape = selectedShape(id);
    if (!id || !shape) return;
    useDoc.getState().updateShape(id, { x: shape.x + dx, y: shape.y + dy }, `nudge:${id}`);
  },
}));

import type { Shape, View } from './types';
import { shapeBounds, type Rect } from './selection';

/**
 * Viewport culling: with thousands of shapes, only the ones near the screen are given to
 * the canvas. Everything stays in the document; this only decides what gets DRAWN.
 */
const boundsCache = new WeakMap<Shape, Rect>(); // shapes keep their identity until edited

function boundsOf(s: Shape): Rect {
  let b = boundsCache.get(s);
  if (!b) {
    b = shapeBounds(s);
    // Text width is only estimated (glyph widths vary), so give it generous room.
    if (s.type === 'text') b = { x: b.x, y: b.y, w: b.w * 1.8 + s.fontSize, h: b.h * 1.5 };
    boundsCache.set(s, b);
  }
  return b;
}

/**
 * The world-space area to draw: the screen plus half a screen of margin on every side,
 * snapped outward to a coarse grid so the set only changes when you have panned a fair
 * way (not every frame), which keeps React from mounting/unmounting shapes while you drag.
 */
export function viewportRect(view: View, w: number, h: number): Rect {
  const span = Math.max(w, h) / view.scale;
  const step = span / 4;
  const margin = span / 2;
  const x0 = -view.x / view.scale - margin;
  const y0 = -view.y / view.scale - margin;
  const x1 = x0 + w / view.scale + 2 * margin;
  const y1 = y0 + h / view.scale + 2 * margin;
  const fx = Math.floor(x0 / step) * step;
  const fy = Math.floor(y0 / step) * step;
  return { x: fx, y: fy, w: Math.ceil(x1 / step) * step - fx, h: Math.ceil(y1 / step) * step - fy };
}

/** Shapes touching `vp`, plus any in `always` (selected / being edited), in the given order. */
export function visibleShapes(shapes: Shape[], vp: Rect, always: ReadonlySet<string>): Shape[] {
  const out: Shape[] = [];
  const right = vp.x + vp.w;
  const bottom = vp.y + vp.h;
  for (const s of shapes) {
    if (always.has(s.id)) {
      out.push(s);
      continue;
    }
    const b = boundsOf(s);
    if (!Number.isFinite(b.x + b.y + b.w + b.h)) {
      out.push(s); // can't tell: draw it rather than lose it
      continue;
    }
    if (b.x + b.w < vp.x || b.x > right || b.y + b.h < vp.y || b.y > bottom) continue;
    out.push(s);
  }
  return out;
}

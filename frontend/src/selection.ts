import type { Shape } from './types';

/**
 * Geometry for the Selection tool (rectangle + free/lasso). Pure functions: no React,
 * no store access. All coordinates are world coordinates.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rough text size, same estimate the eraser uses. */
function textSize(s: Extract<Shape, { type: 'text' }>) {
  const lines = s.text.split('\n');
  return {
    w: Math.max(...lines.map((l) => l.length), 1) * s.fontSize * 0.6,
    h: lines.length * s.fontSize * 1.2,
  };
}

/** Bounding box of a shape's ink (including half its stroke). */
export function shapeBounds(s: Shape): Rect {
  switch (s.type) {
    case 'rect':
    case 'ellipse': {
      const p = s.strokeWidth / 2;
      return { x: s.x - p, y: s.y - p, w: s.width + 2 * p, h: s.height + 2 * p };
    }
    case 'line':
    case 'pen': {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i + 1 < s.points.length; i += 2) {
        const px = s.x + s.points[i];
        const py = s.y + s.points[i + 1];
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      const p = s.strokeWidth / 2;
      return { x: minX - p, y: minY - p, w: maxX - minX + 2 * p, h: maxY - minY + 2 * p };
    }
    case 'text': {
      const { w, h } = textSize(s);
      return { x: s.x, y: s.y, w, h };
    }
  }
}

/** Union of several shapes' bounds, or null for an empty list. */
export function unionBounds(shapes: Shape[]): Rect | null {
  if (shapes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    const b = shapeBounds(s);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const rectsOverlap = (a: Rect, b: Rect) =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/** Does segment a-b touch the rectangle? (Liang-Barsky clipping.) */
function segmentTouchesRect(ax: number, ay: number, bx: number, by: number, r: Rect) {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, ax - r.x) &&
    clip(dx, r.x + r.w - ax) &&
    clip(-dy, ay - r.y) &&
    clip(dy, r.y + r.h - ay)
  );
}

/** Even-odd point-in-polygon; poly is flat [x1,y1,x2,y2,...]. */
export function pointInPolygon(px: number, py: number, poly: number[]) {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i];
    const yi = poly[2 * i + 1];
    const xj = poly[2 * j];
    const yj = poly[2 * j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Points spread along a shape's visible outline, used for lasso hit-testing. */
function samplePoints(s: Shape): number[] {
  const out: number[] = [];
  const along = (pts: number[], ox: number, oy: number) => {
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const ax = ox + pts[i];
      const ay = oy + pts[i + 1];
      out.push(ax, ay);
      if (i + 3 < pts.length) {
        const bx = ox + pts[i + 2];
        const by = oy + pts[i + 3];
        const n = Math.min(400, Math.floor(Math.hypot(bx - ax, by - ay) / 6));
        for (let k = 1; k <= n; k++) out.push(ax + ((bx - ax) * k) / (n + 1), ay + ((by - ay) * k) / (n + 1));
      }
    }
  };
  switch (s.type) {
    case 'line':
    case 'pen':
      along(s.points, s.x, s.y);
      break;
    case 'rect':
      along([s.x, s.y, s.x + s.width, s.y, s.x + s.width, s.y + s.height, s.x, s.y + s.height, s.x, s.y], 0, 0);
      break;
    case 'ellipse': {
      const rx = s.width / 2;
      const ry = s.height / 2;
      const n = Math.min(240, Math.max(32, Math.ceil((2 * Math.PI * Math.max(rx, ry)) / 6)));
      for (let i = 0; i < n; i++) {
        const t = (2 * Math.PI * i) / n;
        out.push(s.x + rx + rx * Math.cos(t), s.y + ry + ry * Math.sin(t));
      }
      break;
    }
    case 'text': {
      const b = shapeBounds(s);
      along([b.x, b.y, b.x + b.w, b.y, b.x + b.w, b.y + b.h, b.x, b.y + b.h, b.x, b.y], 0, 0);
      out.push(b.x + b.w / 2, b.y + b.h / 2);
      break;
    }
  }
  return out;
}

/** Rectangle selection: every shape the rectangle touches. */
export function shapesInRect(shapes: Shape[], r: Rect): string[] {
  const ids: string[] = [];
  for (const s of shapes) {
    if (!rectsOverlap(shapeBounds(s), r)) continue;
    if (s.type === 'line' || s.type === 'pen') {
      // A diagonal stroke's bounding box can overlap the rectangle without the stroke
      // touching it, so test the segments themselves.
      const pad = s.strokeWidth / 2;
      const rr = { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
      let hit = false;
      for (let i = 0; i + 3 < s.points.length && !hit; i += 2) {
        hit = segmentTouchesRect(s.x + s.points[i], s.y + s.points[i + 1], s.x + s.points[i + 2], s.y + s.points[i + 3], rr);
      }
      if (!hit) continue;
    }
    ids.push(s.id);
  }
  return ids;
}

/** Free (lasso) selection: every shape with some of its outline inside the drawn loop. */
export function shapesInLasso(shapes: Shape[], poly: number[]): string[] {
  if (poly.length < 6) return [];
  const ids: string[] = [];
  for (const s of shapes) {
    const pts = samplePoints(s);
    let hit = false;
    for (let i = 0; i + 1 < pts.length && !hit; i += 2) hit = pointInPolygon(pts[i], pts[i + 1], poly);
    if (!hit && s.type !== 'line' && s.type !== 'pen') {
      // A small loop drawn inside a big box / ellipse / label should still pick it.
      const b = shapeBounds(s);
      for (let i = 0; i + 1 < poly.length && !hit; i += 2) {
        hit = poly[i] >= b.x && poly[i] <= b.x + b.w && poly[i + 1] >= b.y && poly[i + 1] <= b.y + b.h;
      }
    }
    if (hit) ids.push(s.id);
  }
  return ids;
}

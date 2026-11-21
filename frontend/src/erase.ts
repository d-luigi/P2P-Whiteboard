import type { LineShape, PenShape, Shape } from './types';

/**
 * Geometry for the eraser. Pure functions, no React / store access, so it can be
 * tested on its own; it works on plain shape objects, independent of how they are stored.
 */

/** Distance from point p to the segment a-b. */
export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from a point to a shape's visible ink (0 = touching it). */
export function distToShape(s: Shape, px: number, py: number): number {
  switch (s.type) {
    case 'line':
    case 'pen': {
      let best = Infinity;
      for (let i = 0; i + 3 < s.points.length; i += 2) {
        const d = distToSegment(
          px - s.x,
          py - s.y,
          s.points[i],
          s.points[i + 1],
          s.points[i + 2],
          s.points[i + 3],
        );
        if (d < best) best = d;
      }
      return Math.max(0, best - s.strokeWidth / 2);
    }
    case 'rect': {
      const { x, y, width: w, height: h } = s;
      const inside = px >= x && px <= x + w && py >= y && py <= y + h;
      if (inside && s.fill !== 'transparent') return 0;
      const d = Math.min(
        distToSegment(px, py, x, y, x + w, y),
        distToSegment(px, py, x + w, y, x + w, y + h),
        distToSegment(px, py, x + w, y + h, x, y + h),
        distToSegment(px, py, x, y + h, x, y),
      );
      return Math.max(0, d - s.strokeWidth / 2);
    }
    case 'ellipse': {
      const rx = Math.max(s.width / 2, 0.5);
      const ry = Math.max(s.height / 2, 0.5);
      const k = Math.hypot((px - (s.x + rx)) / rx, (py - (s.y + ry)) / ry); // 1 = on the outline
      if (k <= 1 && s.fill !== 'transparent') return 0;
      return Math.max(0, Math.abs(k - 1) * Math.min(rx, ry) - s.strokeWidth / 2);
    }
    case 'text': {
      const lines = s.text.split('\n');
      const w = Math.max(...lines.map((l) => l.length)) * s.fontSize * 0.6;
      const h = lines.length * s.fontSize * 1.2;
      const dx = Math.max(s.x - px, 0, px - (s.x + w));
      const dy = Math.max(s.y - py, 0, py - (s.y + h));
      return Math.hypot(dx, dy);
    }
  }
}

/* ---------- partial erase ---------- */

const MIN_PIECE_LEN = 0.5; // world px; shorter leftovers are dropped instead of leaving specks

function pathLength(p: number[]) {
  let len = 0;
  for (let i = 0; i + 3 < p.length; i += 2) len += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
  return len;
}

/**
 * Cut the part of a polyline (flat [x1,y1,x2,y2,...]) that lies inside the circle
 * (cx, cy, R) and return what is left as separate pieces. Cuts land exactly on the
 * circle edge, even on long segments between sparse points. `closed` = the polyline
 * is a loop (first point == last point), so the end pieces get joined back together.
 */
export function clipPolyline(p: number[], cx: number, cy: number, R: number, closed = false) {
  const n = p.length / 2;
  const R2 = R * R;
  const outside = (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 > R2;

  let pieces: number[][] = [];
  let cur: number[] = [];
  let touched = false;
  const flush = () => {
    if (cur.length >= 4) pieces.push(cur);
    cur = [];
  };

  const startOutside = outside(p[0], p[1]);
  const endOutside = outside(p[2 * n - 2], p[2 * n - 1]);
  if (startOutside) cur.push(p[0], p[1]);
  else touched = true;

  for (let i = 0; i < n - 1; i++) {
    const ax = p[2 * i];
    const ay = p[2 * i + 1];
    const bx = p[2 * i + 2];
    const by = p[2 * i + 3];
    const dx = bx - ax;
    const dy = by - ay;
    const fx = ax - cx;
    const fy = ay - cy;
    const a = dx * dx + dy * dy;

    // Parameter range [t0, t1] of this segment that is inside the circle.
    let t0 = 1;
    let t1 = 0; // empty unless found below
    if (a > 1e-12) {
      const b = 2 * (fx * dx + fy * dy);
      const c = fx * fx + fy * fy - R2;
      const disc = b * b - 4 * a * c;
      if (disc > 0) {
        const s = Math.sqrt(disc);
        t0 = (-b - s) / (2 * a);
        t1 = (-b + s) / (2 * a);
      }
    }

    if (!(t1 > 0 && t0 < 1)) {
      // Segment never enters the circle.
      if (outside(bx, by)) cur.push(bx, by);
      continue;
    }

    touched = true;
    if (t0 > 0) {
      cur.push(ax + t0 * dx, ay + t0 * dy); // entering the circle: close the current piece
      flush();
    }
    cur = [];
    if (t1 < 1) cur = [ax + t1 * dx, ay + t1 * dy, bx, by]; // leaving the circle: start a new piece
  }
  flush();

  if (!touched) return null;

  // A closed outline (rect / ellipse) that was cut elsewhere: join its last and first
  // pieces so the original start corner stays one continuous stroke.
  if (closed && pieces.length >= 2 && startOutside && endOutside) {
    const last = pieces.pop()!;
    pieces[0] = [...last, ...pieces[0].slice(2)];
  }
  pieces = pieces.filter((q) => pathLength(q) >= MIN_PIECE_LEN);
  return pieces;
}

function clipShape(
  line: PenShape | LineShape,
  cx: number,
  cy: number,
  r: number,
  closed: boolean,
  newId: () => string,
): Shape[] | null {
  const R = r + line.strokeWidth / 2; // cut the centre-line far enough that the ink clears the ring
  const pieces = clipPolyline(line.points, cx - line.x, cy - line.y, R, closed);
  if (!pieces) return null;
  // The first piece keeps the original id (and so its selection / identity).
  const lastX = line.points[line.points.length - 2];
  const lastY = line.points[line.points.length - 1];
  return pieces.map((points, i) => {
    const piece = { ...line, id: i === 0 ? line.id : newId(), points } as typeof line;
    if (piece.type === 'line' && piece.arrow) {
      // Only the piece that still ends where the original ended keeps its arrowhead.
      piece.arrow = points[points.length - 2] === lastX && points[points.length - 1] === lastY;
    }
    return piece;
  });
}

/**
 * Erase only the part of shape `s` that lies under the eraser circle (cx, cy, r).
 *
 *  - null      -> the eraser doesn't touch it; leave it alone
 *  - []        -> nothing left; delete it
 *  - Shape[]   -> replace it with these pieces (the first keeps s.id)
 *
 * Pen strokes and lines are cut. Unfilled rectangles / ellipses are cut too: the first
 * time the eraser touches one it turns into line pieces. Filled shapes and text can't
 * be cut meaningfully, so they are removed whole.
 *
 * `scale` is the camera zoom; rect / ellipse outlines are drawn with a screen-constant
 * width, so their converted line pieces get strokeWidth / scale to look identical.
 */
export function erasePartial(
  s: Shape,
  cx: number,
  cy: number,
  r: number,
  scale: number,
  newId: () => string,
): Shape[] | null {
  switch (s.type) {
    case 'pen':
    case 'line':
      return clipShape(s, cx, cy, r, false, newId);

    case 'text':
      return distToShape(s, cx, cy) <= r ? [] : null;

    case 'rect':
    case 'ellipse': {
      if (s.fill !== 'transparent') return distToShape(s, cx, cy) <= r ? [] : null;

      let points: number[];
      if (s.type === 'rect') {
        const { x, y, width: w, height: h } = s;
        points = [x, y, x + w, y, x + w, y + h, x, y + h, x, y];
      } else {
        const rx = s.width / 2;
        const ry = s.height / 2;
        const n = Math.min(240, Math.max(48, Math.ceil((2 * Math.PI * Math.max(rx, ry)) / 5)));
        points = [];
        for (let i = 0; i <= n; i++) {
          const t = (2 * Math.PI * i) / n;
          points.push(s.x + rx + rx * Math.cos(t), s.y + ry + ry * Math.sin(t));
        }
      }
      const outline: LineShape = {
        id: s.id,
        z: s.z,
        type: 'line',
        x: 0,
        y: 0,
        stroke: s.stroke,
        strokeWidth: s.strokeWidth / scale,
        points,
      };
      return clipShape(outline, cx, cy, r, true, newId);
    }
  }
}

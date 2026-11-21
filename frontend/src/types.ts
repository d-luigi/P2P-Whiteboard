/** partial = erase only the part under the cursor (default); stroke = remove the whole shape. */
export type EraserMode = 'partial' | 'stroke';

export type Tool =
  | 'select'
  | 'hand'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'pen'
  | 'text'
  | 'eraser';

interface BaseShape {
  id: string;
  z: number; // stacking order (higher = on top). Plain field so it can live in a Y.Map later.
  x: number;
  y: number;
  stroke: string;
  strokeWidth: number;
}

export interface RectShape extends BaseShape {
  type: 'rect';
  width: number;
  height: number;
  fill: string; // 'transparent' = no fill
}

export interface EllipseShape extends BaseShape {
  type: 'ellipse';
  // Bounding box (top-left x/y + size), same as rect.
  width: number;
  height: number;
  fill: string;
}

export interface LineShape extends BaseShape {
  type: 'line';
  points: number[]; // [x1, y1, x2, y2], relative to (x, y)
}

export interface PenShape extends BaseShape {
  type: 'pen';
  points: number[]; // [x1, y1, x2, y2, ...], relative to (x, y)
}

export interface TextShape extends BaseShape {
  type: 'text';
  text: string;
  fontSize: number;
}

export type Shape = RectShape | EllipseShape | LineShape | PenShape | TextShape;

export interface Style {
  stroke: string;
  fill: string;
  strokeWidth: number;
}

// Per-user camera. Never shared between peers.
export interface View {
  x: number;
  y: number;
  scale: number;
}

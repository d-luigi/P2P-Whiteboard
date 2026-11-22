import type { Shape } from './types';

/**
 * Shapes arrive from the network (peers) and from imported backups, so they are UNTRUSTED.
 * A malformed one (wrong type, NaN, a 10-million-point stroke) must never reach the renderer,
 * where it could crash every connected browser. Anything that fails here is simply ignored.
 */
const MAX_POINTS = 200_000; // numbers, i.e. 100k points
const MAX_TEXT = 10_000;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const points = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length >= 2 && v.length <= MAX_POINTS && v.length % 2 === 0 && v.every(num);

export function sanitizeShape(raw: unknown): Shape | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!str(s.id, 80) || s.id === '') return null;
  if (!num(s.x) || !num(s.y)) return null;
  if (!str(s.stroke, 64) || !num(s.strokeWidth) || s.strokeWidth < 0 || s.strokeWidth > 1000) return null;

  // Boards saved by very early versions had no stacking order: treat that as 0.
  const base = num(s.z) ? s : { ...s, z: 0 };

  switch (s.type) {
    case 'rect':
    case 'ellipse':
      return num(s.width) && num(s.height) && s.width >= 0 && s.height >= 0 && str(s.fill, 64)
        ? (base as unknown as Shape)
        : null;
    case 'line':
      return points(s.points) && (s.arrow === undefined || typeof s.arrow === 'boolean')
        ? (base as unknown as Shape)
        : null;
    case 'pen':
      return points(s.points) ? (base as unknown as Shape) : null;
    case 'text':
      return str(s.text, MAX_TEXT) && num(s.fontSize) && s.fontSize > 0 && s.fontSize <= 1000
        ? (base as unknown as Shape)
        : null;
    default:
      return null;
  }
}

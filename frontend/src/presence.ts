import { create } from 'zustand';
import { awareness } from './sync';
import { useUI, centredView, MIN_SCALE, MAX_SCALE } from './uiStore';
import type { View } from './types';

/**
 * PRESENCE (Yjs Awareness): who is here and what they are doing right now. This is
 * ephemeral. It is never saved in the document, never undoable, and disappears when a peer
 * leaves. Each peer broadcasts one small state object:
 *
 *   user    { name, color }
 *   cursor  { x, y } in WORLD coordinates, or null when the pointer is off the board
 *   laser   { x, y } while the laser pointer is held down, else null
 *   view    { cx, cy, scale }: the world point at the middle of their screen + zoom
 *             (what "follow" uses; sent as centre + zoom so it works across screen sizes)
 *
 * Everything received from a peer is untrusted: it is validated before use.
 */
export interface Point {
  x: number;
  y: number;
}
export interface PeerView {
  cx: number;
  cy: number;
  scale: number;
}
export interface UserInfo {
  name: string;
  color: string;
}
export interface Peer extends UserInfo {
  id: number; // awareness client id (one per tab)
  cursor: Point | null;
  laser: Point | null;
  view: PeerView | null;
}

export const PALETTE = [
  '#e03131', '#d9480f', '#f08c00', '#2f9e44', '#099268',
  '#0c8599', '#1971c2', '#6741d9', '#c2255c', '#495057',
];
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const NAME_MAX = 24;

export const myId = awareness.clientID;

/* ---------- my identity (remembered in this browser, shared by all boards) ---------- */

const USER_KEY = 'p2pwb:user';
const ADJECTIVES = ['Curious', 'Swift', 'Calm', 'Bright', 'Brave', 'Clever', 'Gentle', 'Lucky', 'Merry', 'Quiet', 'Witty', 'Bold'];
const ANIMALS = ['Otter', 'Falcon', 'Panda', 'Lynx', 'Heron', 'Koala', 'Gecko', 'Fox', 'Owl', 'Seal', 'Newt', 'Wren'];

function pick(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}

function loadUser(): UserInfo {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) {
      const u = JSON.parse(raw) as { name?: unknown; color?: unknown };
      if (
        typeof u.name === 'string' && u.name.trim() && u.name.length <= NAME_MAX &&
        typeof u.color === 'string' && COLOR_RE.test(u.color)
      ) {
        return { name: u.name, color: u.color };
      }
    }
  } catch {
    /* fall through to a new identity */
  }
  const user = { name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(PALETTE) };
  saveUser(user);
  return user;
}

function saveUser(user: UserInfo) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}

interface PresenceState {
  me: UserInfo;
  /** Everyone else on this board right now (other tabs included), sorted by name. */
  peers: Peer[];
}

export const usePresence = create<PresenceState>(() => ({ me: loadUser(), peers: [] }));

function updateMe(patch: Partial<UserInfo>) {
  const me = { ...usePresence.getState().me, ...patch };
  usePresence.setState({ me });
  saveUser(me);
  awareness.setLocalStateField('user', me);
}

export function setName(name: string) {
  const clean = name.trim().slice(0, NAME_MAX);
  if (clean) updateMe({ name: clean });
}

export function setColor(color: string) {
  if (COLOR_RE.test(color)) updateMe({ color });
}

/* ---------- sending my state (throttled) ---------- */

function makeSender(field: string, baseMs: number) {
  let pending: unknown;
  let has = false;
  let timer = 0;
  let last = 0;
  const flush = () => {
    timer = 0;
    last = performance.now();
    if (has) {
      has = false;
      awareness.setLocalStateField(field, pending);
    }
  };
  return (value: unknown, immediate = false) => {
    if (document.hidden && !immediate) return; // nobody is watching a hidden tab's cursor
    pending = value;
    has = true;
    // With a crowd, every peer's updates fan out to everyone else: send less often.
    const ms = awareness.getStates().size > 6 ? baseMs * 2.5 : baseMs;
    const wait = ms - (performance.now() - last);
    if (immediate || wait <= 0) {
      clearTimeout(timer);
      flush();
    } else if (!timer) {
      timer = window.setTimeout(flush, wait);
    }
  };
}

const sendCursor = makeSender('cursor', 33);
const sendLaser = makeSender('laser', 25);
const sendView = makeSender('view', 50);

const toPeerView = (v: View): PeerView => ({
  cx: (window.innerWidth / 2 - v.x) / v.scale,
  cy: (window.innerHeight / 2 - v.y) / v.scale,
  scale: v.scale,
});

/** Laser trails (also drawn for my own laser). Read by the canvas in Cursors.tsx. */
export interface TrailPoint {
  x: number;
  y: number;
  t: number;
}
export const trails = new Map<number, TrailPoint[]>();

function pushTrail(id: number, p: Point) {
  const list = trails.get(id) ?? [];
  const last = list[list.length - 1];
  if (last && last.x === p.x && last.y === p.y) return;
  list.push({ x: p.x, y: p.y, t: performance.now() });
  if (list.length > 60) list.splice(0, list.length - 60);
  trails.set(id, list);
}

let localLaser: Point | null = null;
export const getLocalLaser = () => localLaser;

function setCursor(p: Point | null, immediate = false) {
  sendCursor(p, immediate);
}

function setLaser(p: Point | null) {
  localLaser = p;
  if (p) pushTrail(myId, p);
  sendLaser(p, p === null);
}

/* ---------- receiving everyone else's state ---------- */

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validPoint(v: unknown): Point | null {
  const o = v as { x?: unknown; y?: unknown } | null;
  return o && num(o.x) && num(o.y) ? { x: o.x, y: o.y } : null;
}

function validView(v: unknown): PeerView | null {
  const o = v as { cx?: unknown; cy?: unknown; scale?: unknown } | null;
  return o && num(o.cx) && num(o.cy) && num(o.scale)
    ? { cx: o.cx, cy: o.cy, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, o.scale)) }
    : null;
}

function applyFollowed(v: PeerView) {
  const cur = useUI.getState().view;
  const next = centredView(v.cx, v.cy, v.scale);
  if (
    Math.abs(cur.x - next.x) < 0.5 &&
    Math.abs(cur.y - next.y) < 0.5 &&
    Math.abs(cur.scale - next.scale) < 1e-4
  ) {
    return;
  }
  // Set directly (not via setView), because setView means "the user moved" and ends following.
  useUI.setState({ view: next });
}

function recompute() {
  const peers: Peer[] = [];
  awareness.getStates().forEach((raw, id) => {
    if (id === myId) return;
    const s = raw as { user?: { name?: unknown; color?: unknown }; cursor?: unknown; laser?: unknown; view?: unknown };
    if (!s?.user) return;
    const laser = validPoint(s.laser);
    if (laser) pushTrail(id, laser);
    peers.push({
      id,
      name: typeof s.user.name === 'string' && s.user.name.trim() ? s.user.name.slice(0, NAME_MAX) : 'Guest',
      color: typeof s.user.color === 'string' && COLOR_RE.test(s.user.color) ? s.user.color : '#495057',
      cursor: validPoint(s.cursor),
      laser,
      view: validView(s.view),
    });
  });
  peers.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  usePresence.setState({ peers });

  const followId = useUI.getState().followId;
  if (followId !== null) {
    const target = peers.find((p) => p.id === followId);
    if (!target) useUI.getState().setFollow(null); // they left
    else if (target.view) applyFollowed(target.view);
  }
}

awareness.on('change', (c: { added: number[]; updated: number[]; removed: number[] }) => {
  // My own cursor moves don't change anyone else's state, so skip them.
  if (c.added.length || c.removed.length || c.updated.some((id) => id !== myId)) recompute();
});

/** Follow a peer's camera (null = stop). Panning or zooming yourself also stops it. */
export function follow(id: number | null) {
  useUI.getState().setFollow(id);
  if (id === null) return;
  const target = usePresence.getState().peers.find((p) => p.id === id);
  if (target?.view) applyFollowed(target.view);
}

/* ---------- wiring: my state starts, my camera and pointer are broadcast ---------- */

awareness.setLocalState({
  user: usePresence.getState().me,
  cursor: null,
  laser: null,
  view: toPeerView(useUI.getState().view),
});
recompute();

useUI.subscribe((s, prev) => {
  if (s.view !== prev.view) sendView(toPeerView(s.view));
});

const worldPoint = (e: PointerEvent): Point => {
  const v = useUI.getState().view;
  return { x: (e.clientX - v.x) / v.scale, y: (e.clientY - v.y) / v.scale };
};
const onBoard = (t: EventTarget | null) => t instanceof Element && !!t.closest('.board');

let laserDown = false;

window.addEventListener('pointermove', (e) => {
  if (!onBoard(e.target)) {
    setCursor(null, true);
    return;
  }
  const p = worldPoint(e);
  setCursor(p);
  if (laserDown) setLaser(p);
});

window.addEventListener('pointerdown', (e) => {
  if (useUI.getState().tool === 'laser' && onBoard(e.target)) {
    laserDown = true;
    setLaser(worldPoint(e));
  }
});

const endPointer = (e: PointerEvent) => {
  if (laserDown) {
    laserDown = false;
    setLaser(null);
  }
  if (e.pointerType === 'touch') setCursor(null, true); // a lifted finger has no cursor
};
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);

// Pointer left the window / window lost focus: hide my cursor for everyone else.
window.addEventListener('mouseout', (e) => {
  if (!e.relatedTarget) setCursor(null, true);
});
window.addEventListener('blur', () => {
  setCursor(null, true);
  if (laserDown) {
    laserDown = false;
    setLaser(null);
  }
});

import { useEffect, useRef } from 'react';
import { usePresence, trails, getLocalLaser, myId } from '../presence';
import { useUI } from '../uiStore';

/** Other people's pointers, drawn over the board (HTML, so names stay crisp at any zoom). */
export function RemoteCursors() {
  const peers = usePresence((s) => s.peers);
  const view = useUI((s) => s.view);
  return (
    <div className="cursors" aria-hidden="true">
      {peers.map(
        (p) =>
          p.cursor && (
            <div
              key={p.id}
              className="cursor"
              style={{
                transform: `translate(${view.x + p.cursor.x * view.scale}px, ${view.y + p.cursor.y * view.scale}px)`,
              }}
            >
              <svg width="18" height="22" viewBox="0 0 18 22">
                <path
                  d="M1 1 L1 17 L5.5 13 L9 21 L12 19.5 L8.6 12 L15 12 Z"
                  fill={p.color}
                  stroke="#fff"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="cursor-label" style={{ background: p.color }}>
                {p.name}
              </span>
            </div>
          ),
      )}
    </div>
  );
}

const TRAIL_MS = 700;

/** Laser pointers: a glowing dot while held, and a trail that fades after release. */
export function LaserCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    window.addEventListener('resize', fit);

    let raf = 0;
    let dirty = false; // something was drawn last frame, so it must be cleared
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const { view } = useUI.getState();
      const { peers, me } = usePresence.getState();
      const toScreen = (x: number, y: number): [number, number] => [view.x + x * view.scale, view.y + y * view.scale];
      const colorOf = (id: number) => (id === myId ? me.color : (peers.find((p) => p.id === id)?.color ?? '#e03131'));

      // Forget trail points that have fully faded.
      for (const [id, list] of trails) {
        while (list.length > 0 && now - list[0].t > TRAIL_MS) list.shift();
        if (list.length === 0) trails.delete(id);
      }
      const heads = new Map<number, { x: number; y: number }>();
      for (const p of peers) if (p.laser) heads.set(p.id, p.laser);
      const mine = getLocalLaser();
      if (mine) heads.set(myId, mine);

      if (trails.size === 0 && heads.size === 0 && !dirty) return;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      dirty = trails.size > 0 || heads.size > 0;

      ctx.lineCap = 'round';
      for (const [id, list] of trails) {
        ctx.strokeStyle = colorOf(id);
        ctx.lineWidth = 4;
        for (let i = 1; i < list.length; i++) {
          ctx.globalAlpha = Math.max(0, 1 - (now - list[i].t) / TRAIL_MS);
          const [x0, y0] = toScreen(list[i - 1].x, list[i - 1].y);
          const [x1, y1] = toScreen(list[i].x, list[i].y);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      for (const [id, pt] of heads) {
        const [x, y] = toScreen(pt.x, pt.y);
        ctx.shadowColor = colorOf(id);
        ctx.shadowBlur = 14;
        ctx.fillStyle = colorOf(id);
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
    };
  }, []);

  return <canvas ref={ref} className="laser-canvas" aria-hidden="true" />;
}

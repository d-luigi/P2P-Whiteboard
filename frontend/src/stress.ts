import { bulkAddShapes } from './docStore';
import { useUI } from './uiStore';
import type { Shape } from './types';

/**
 * DEV ONLY (loaded from main.tsx when running `npm run dev`). In the browser console:
 *
 *   p2pwbStress(2000)      add 2,000 random shapes, then pan across them for 4 s and log the
 *                          average frame rate. (Not undoable. Use a scratch board!)
 */
function makeShapes(n: number, spread: number): Shape[] {
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const out: Shape[] = [];
  for (let i = 0; i < n; i++) {
    const x = rnd(-spread, spread);
    const y = rnd(-spread, spread);
    const base = { id: crypto.randomUUID(), z: i, x, y, stroke: '#1f2430', strokeWidth: 3 };
    const k = i % 4;
    if (k === 0) out.push({ ...base, type: 'rect', width: rnd(30, 140), height: rnd(30, 100), fill: 'transparent' });
    else if (k === 1) out.push({ ...base, type: 'ellipse', width: rnd(30, 120), height: rnd(30, 120), fill: '#fde68a' });
    else if (k === 2) {
      const pts: number[] = [];
      let px = 0;
      let py = 0;
      for (let j = 0; j < 60; j++) {
        px += rnd(-6, 6);
        py += rnd(-6, 6);
        pts.push(px, py);
      }
      out.push({ ...base, type: 'pen', points: pts });
    } else out.push({ ...base, type: 'text', text: `note ${i}`, fontSize: 20 });
  }
  return out;
}

async function measurePan(ms: number, spread: number) {
  const { setView } = useUI.getState();
  const start = useUI.getState().view;
  const t0 = performance.now();
  let frames = 0;
  await new Promise<void>((done) => {
    const tick = (now: number) => {
      const t = (now - t0) / ms;
      if (t >= 1) return done();
      frames++;
      setView({ ...start, x: start.x - t * spread * 1.6 * start.scale });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return (frames / ms) * 1000;
}

(window as unknown as Record<string, unknown>).p2pwbStress = async (n = 1000) => {
  const spread = Math.sqrt(n) * 120;
  const t0 = performance.now();
  bulkAddShapes(makeShapes(n, spread));
  console.info(`Added ${n} shapes in ${(performance.now() - t0).toFixed(0)} ms. Panning across them…`);
  const fps = await measurePan(4000, spread);
  console.info(`Average while panning: ${fps.toFixed(0)} fps`);
  return fps;
};

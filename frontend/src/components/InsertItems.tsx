import { useRef, useState } from 'react';
import { useDoc } from '../docStore';
import { useUI } from '../uiStore';
import { readOnly } from '../board';
import { toast } from '../toast';
import type { RectShape, Shape } from '../types';

const templates = {
  kanban: ['To do', 'In progress', 'Done'],
  brainstorm: ['Ideas', 'Questions', 'Next steps'],
  retrospective: ['Went well', 'Could improve', 'Actions'],
};

export default function InsertItems({ onDone }: { onDone?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const centre = () => {
    const v = useUI.getState().view;
    return { x: (window.innerWidth / 2 - v.x) / v.scale, y: (window.innerHeight / 2 - v.y) / v.scale };
  };
  const rectangle = (x: number, y: number, width: number, height: number, fill: string): RectShape => ({
    id: crypto.randomUUID(), type: 'rect', z: Date.now(), x, y, width, height, fill, stroke: '#263238', strokeWidth: 1,
  });
  const insert = (shapes: Shape[]) => {
    if (readOnly) return;
    useDoc.getState().replaceShapes([], shapes);
    useUI.getState().setTool('move');
    useUI.getState().setSelection(shapes.map((s) => s.id));
    onDone?.();
  };
  const sticky = () => {
    const note = window.prompt('Sticky note text');
    if (note === null) return;
    const p = centre();
    insert([{ ...rectangle(p.x - 110, p.y - 90, 220, 180, '#fff59d'), note: note.slice(0, 10000) }]);
    toast('Double-click or double-tap a sticky note to edit it.');
  };
  const upload = async (file: File) => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { toast('Choose a PNG, JPEG, WebP, or GIF file.', 'error'); return; }
    if (file.size > 2 * 1024 * 1024) { toast('Choose an image or GIF smaller than 2 MB.', 'error'); return; }
    setBusy(true);
    try {
      const media = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
      });
      const img = new Image();
      img.src = media;
      await img.decode();
      if (img.naturalWidth * img.naturalHeight > 16_000_000) throw new Error('Image dimensions are too large (maximum 16 megapixels).');
      const scale = Math.min(1, 480 / img.naturalWidth, 360 / img.naturalHeight);
      const width = img.naturalWidth * scale, height = img.naturalHeight * scale;
      const p = centre();
      insert([{ ...rectangle(p.x - width / 2, p.y - height / 2, width, height, '#ffffff'), media }]);
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not load that image.', 'error'); }
    finally { setBusy(false); }
  };
  const template = (name: keyof typeof templates) => {
    const p = centre();
    const colors = ['#fff59d', '#b3e5fc', '#c8e6c9'];
    const shapes: Shape[] = [];
    templates[name].forEach((title, i) => {
      const x = p.x - 420 + i * 280;
      shapes.push(rectangle(x, p.y - 240, 260, 480, '#f8fafc'));
      shapes.push({ id: crypto.randomUUID(), type: 'text', z: Date.now() + 1, x: x + 16, y: p.y - 220, text: title, fontSize: 24, stroke: '#263238', strokeWidth: 1 });
      shapes.push({ ...rectangle(x + 20, p.y - 165, 220, 180, colors[i]), z: Date.now() + 2, note: 'Double-tap to edit' });
    });
    insert(shapes);
    useUI.getState().setView({ x: window.innerWidth / 2 - p.x * Math.min(1, (window.innerWidth - 40) / 840), y: window.innerHeight / 2 - p.y * Math.min(1, (window.innerWidth - 40) / 840), scale: Math.min(1, (window.innerWidth - 40) / 840) });
  };
  if (readOnly) return null;
  return <div className="group edit-only" role="group" aria-label="Insert items">
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file); }} />
    <button className="btn wide" disabled={busy} onClick={() => { if (input.current) { input.current.accept = 'image/png,image/jpeg,image/webp'; input.current.click(); } }}>Image</button>
    <button className="btn wide" disabled={busy} onClick={() => { if (input.current) { input.current.accept = 'image/gif'; input.current.click(); } }}>GIF</button>
    <button className="btn wide" onClick={sticky}>Sticky note</button>
    <select className="btn wide" aria-label="Board templates" value="" onChange={(e) => { if (e.target.value) template(e.target.value as keyof typeof templates); }}>
      <option value="">Templates</option>
      <option value="kanban">Kanban</option><option value="brainstorm">Brainstorming</option><option value="retrospective">Retrospective</option>
    </select>
  </div>;
}

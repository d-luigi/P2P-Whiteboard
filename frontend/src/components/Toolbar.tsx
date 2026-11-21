import { useState, type FormEvent } from 'react';
import { useDoc } from '../docStore';
import { useUI } from '../uiStore';
import { boardId, newBoard } from '../board';
import type { EraserMode, MarqueeMode, Tool } from '../types';

const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: 'select', icon: '↖', label: 'Select', key: 'V' },
  { id: 'marquee', icon: '⬚', label: 'Selection', key: 'M' },
  { id: 'hand', icon: '✋', label: 'Pan', key: 'H' },
  { id: 'rect', icon: '▭', label: 'Rectangle', key: 'R' },
  { id: 'ellipse', icon: '◯', label: 'Ellipse', key: 'O' },
  { id: 'line', icon: '／', label: 'Line', key: 'L' },
  { id: 'arrow', icon: '→', label: 'Arrow', key: 'A' },
  { id: 'pen', icon: '✎', label: 'Marker', key: 'P' },
  { id: 'text', icon: 'T', label: 'Text', key: 'T' },
  { id: 'eraser', icon: '⌫', label: 'Eraser', key: 'E' },
  { id: 'laser', icon: '◉', label: 'Laser pointer (visible to others)', key: 'K' },
];

const ERASER_MODES: { id: EraserMode; label: string; title: string }[] = [
  { id: 'partial', label: 'Partial', title: 'Erase only the part under the eraser' },
  { id: 'stroke', label: 'Stroke', title: 'Erase the whole stroke or shape you touch' },
];

const MARQUEE_MODES: { id: MarqueeMode; label: string; title: string }[] = [
  { id: 'rect', label: 'Rectangle', title: 'Drag a rectangle to select what it touches' },
  { id: 'free', label: 'Free', title: 'Draw any shape around what you want to select' },
];

const STROKE_SIZES = [2, 4, 8, 14, 24]; // px, for marker, lines and shape outlines
const ERASER_SIZES = [12, 24, 48, 96]; // px diameter

export default function Toolbar() {
  const {
    tool,
    setTool,
    style,
    setStyle,
    eraserSize,
    setEraserSize,
    eraserMode,
    setEraserMode,
    marqueeMode,
    setMarqueeMode,
    view,
    zoomAt,
    resetView,
    centerOn,
    goHome,
    selectedIds,
    deleteSelected,
  } = useUI();
  const canUndo = useDoc((s) => s.canUndo);
  const canRedo = useDoc((s) => s.canRedo);
  const undo = useDoc((s) => s.undo);
  const redo = useDoc((s) => s.redo);

  const [fillColor, setFillColor] = useState('#fde68a');
  const filled = style.fill !== 'transparent';

  const isEraser = tool === 'eraser';
  const sizes = isEraser ? ERASER_SIZES : STROKE_SIZES;
  const currentSize = isEraser ? eraserSize : style.strokeWidth;
  const dotSize = (s: number) => (isEraser ? Math.max(5, s / 5) : Math.min(s, 18));

  // Go-to-coordinates popover. The world point at the middle of the screen is "where you are".
  const [goOpen, setGoOpen] = useState(false);
  const [gx, setGx] = useState('');
  const [gy, setGy] = useState('');
  const cx = Math.round((window.innerWidth / 2 - view.x) / view.scale);
  const cy = Math.round((window.innerHeight / 2 - view.y) / view.scale);
  const toggleGo = () => {
    setGx(String(cx));
    setGy(String(cy));
    setGoOpen((o) => !o);
  };
  const submitGo = (e: FormEvent) => {
    e.preventDefault();
    const x = Number(gx.trim());
    const y = Number(gy.trim());
    if (gx.trim() === '' || gy.trim() === '' || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const LIMIT = 1e7; // keep clear of floating-point trouble
    centerOn(Math.max(-LIMIT, Math.min(LIMIT, x)), Math.max(-LIMIT, Math.min(LIMIT, y)));
    setGoOpen(false);
  };

  const zoomCentre = (factor: number) =>
    zoomAt(window.innerWidth / 2, window.innerHeight / 2, factor);

  return (
    <div className="toolbar" role="toolbar" aria-label="Whiteboard tools">
      <div className="group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`btn ${tool === t.id ? 'active' : ''}`}
            title={`${t.label} (${t.key})`}
            aria-label={t.label}
            aria-pressed={tool === t.id}
            onClick={() => setTool(t.id)}
          >
            {t.icon}
          </button>
        ))}
      </div>

      <div className="group">
        <button
          className="btn"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          disabled={!canUndo}
          onClick={undo}
        >
          ↶
        </button>
        <button
          className="btn"
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          disabled={!canRedo}
          onClick={redo}
        >
          ↷
        </button>
      </div>

      {tool === 'marquee' && (
        <div className="group" role="group" aria-label="Selection mode">
          {MARQUEE_MODES.map((m) => (
            <button
              key={m.id}
              className={`btn wide ${marqueeMode === m.id ? 'active' : ''}`}
              title={m.title}
              aria-pressed={marqueeMode === m.id}
              onClick={() => setMarqueeMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {isEraser && (
        <div className="group" role="group" aria-label="Eraser mode">
          {ERASER_MODES.map((m) => (
            <button
              key={m.id}
              className={`btn wide ${eraserMode === m.id ? 'active' : ''}`}
              title={m.title}
              aria-pressed={eraserMode === m.id}
              onClick={() => setEraserMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      <div className="group" role="group" aria-label={isEraser ? 'Eraser size' : 'Stroke size'}>
        {sizes.map((s) => (
          <button
            key={s}
            className={`btn ${currentSize === s ? 'active' : ''}`}
            title={`${isEraser ? 'Eraser' : 'Stroke'} size ${s}px`}
            aria-label={`${s} pixels`}
            aria-pressed={currentSize === s}
            onClick={() => (isEraser ? setEraserSize(s) : setStyle({ strokeWidth: s }))}
          >
            <span
              className={isEraser ? 'dot ring' : 'dot'}
              style={{ width: dotSize(s), height: dotSize(s) }}
            />
          </button>
        ))}
      </div>

      <div className="group">
        <label className="field" title="Stroke colour">
          Stroke
          <input
            type="color"
            value={style.stroke}
            onChange={(e) => setStyle({ stroke: e.target.value })}
          />
        </label>
        <label className="field" title="Fill colour">
          <input
            type="checkbox"
            checked={filled}
            onChange={(e) => setStyle({ fill: e.target.checked ? fillColor : 'transparent' })}
          />
          Fill
          <input
            type="color"
            value={fillColor}
            onChange={(e) => {
              setFillColor(e.target.value);
              if (filled) setStyle({ fill: e.target.value });
            }}
          />
        </label>
      </div>

      <div className="group">
        <button
          className="btn"
          title="Delete selected (Del)"
          aria-label="Delete selected"
          disabled={selectedIds.length === 0}
          onClick={deleteSelected}
        >
          🗑
        </button>
      </div>

      <div className="group">
        <span className="board-id" title={`Board ${boardId}. Saved in this browser; bookmark this link to return.`}>
          {boardId.slice(0, 6)}
        </span>
        <button
          className="btn"
          title="New board (the current one stays saved at its link)"
          aria-label="New board"
          onClick={newBoard}
        >
          ＋
        </button>
      </div>

      <div className="group goto">
        <button
          className="btn"
          title="Back to the centre (0, 0) (Home)"
          aria-label="Back to centre"
          onClick={goHome}
        >
          ⌂
        </button>
        <button
          className={`btn wide coords ${goOpen ? 'active' : ''}`}
          title="Go to coordinates"
          aria-label="Go to coordinates"
          aria-expanded={goOpen}
          onClick={toggleGo}
        >
          {cx}, {cy}
        </button>
        {goOpen && (
          <form
            className="goto-pop"
            onSubmit={submitGo}
            onKeyDown={(e) => e.key === 'Escape' && setGoOpen(false)}
          >
            <label className="field">
              X
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                value={gx}
                onChange={(e) => setGx(e.target.value)}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <label className="field">
              Y
              <input
                type="text"
                inputMode="decimal"
                value={gy}
                onChange={(e) => setGy(e.target.value)}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <button type="submit" className="btn wide go">
              Go
            </button>
          </form>
        )}
      </div>

      <div className="group">
        <button className="btn" title="Zoom out (Ctrl -)" aria-label="Zoom out" onClick={() => zoomCentre(1 / 1.2)}>
          −
        </button>
        <button className="btn wide" title="Reset zoom (Ctrl 0)" onClick={resetView}>
          {Math.round(view.scale * 100)}%
        </button>
        <button className="btn" title="Zoom in (Ctrl +)" aria-label="Zoom in" onClick={() => zoomCentre(1.2)}>
          +
        </button>
      </div>
    </div>
  );
}

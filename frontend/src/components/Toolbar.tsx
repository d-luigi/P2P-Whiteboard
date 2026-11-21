import { useState } from 'react';
import { useDoc } from '../docStore';
import { useUI } from '../uiStore';
import type { EraserMode, Tool } from '../types';

const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: 'select', icon: '↖', label: 'Select', key: 'V' },
  { id: 'hand', icon: '✋', label: 'Pan', key: 'H' },
  { id: 'rect', icon: '▭', label: 'Rectangle', key: 'R' },
  { id: 'ellipse', icon: '◯', label: 'Ellipse', key: 'O' },
  { id: 'line', icon: '／', label: 'Line', key: 'L' },
  { id: 'pen', icon: '✎', label: 'Marker', key: 'P' },
  { id: 'text', icon: 'T', label: 'Text', key: 'T' },
  { id: 'eraser', icon: '⌫', label: 'Eraser', key: 'E' },
];

const ERASER_MODES: { id: EraserMode; label: string; title: string }[] = [
  { id: 'partial', label: 'Partial', title: 'Erase only the part under the eraser' },
  { id: 'stroke', label: 'Stroke', title: 'Erase the whole stroke or shape you touch' },
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
    view,
    zoomAt,
    resetView,
    selectedId,
    deleteSelected,
  } = useUI();
  const canUndo = useDoc((s) => s.past.length > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const undo = useDoc((s) => s.undo);
  const redo = useDoc((s) => s.redo);

  const [fillColor, setFillColor] = useState('#fde68a');
  const filled = style.fill !== 'transparent';

  const isEraser = tool === 'eraser';
  const sizes = isEraser ? ERASER_SIZES : STROKE_SIZES;
  const currentSize = isEraser ? eraserSize : style.strokeWidth;
  const dotSize = (s: number) => (isEraser ? Math.max(5, s / 5) : Math.min(s, 18));

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
          disabled={!selectedId}
          onClick={deleteSelected}
        >
          🗑
        </button>
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

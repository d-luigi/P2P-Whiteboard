import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Group, Rect, Ellipse, Line, Text, Circle, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useDoc } from '../docStore';
import { useUI } from '../uiStore';
import { distToShape, erasePartial } from '../erase';
import type { Shape } from '../types';

type Evt = Konva.KonvaEventObject<MouseEvent | TouchEvent>;
interface Pt {
  x: number;
  y: number;
}

/* ---------- small helpers ---------- */

/** True if any point is more than 2px away from the first one. */
function moved(points: number[]) {
  for (let i = 2; i < points.length; i += 2) {
    if (Math.hypot(points[i] - points[0], points[i + 1] - points[1]) > 2) return true;
  }
  return false;
}

function isMeaningful(s: Shape) {
  if (s.type === 'rect' || s.type === 'ellipse') return s.width > 2 || s.height > 2;
  if (s.type === 'line' || s.type === 'pen') return moved(s.points);
  return true;
}

/* ---------- one shape on the canvas ---------- */

function ShapeNode({ shape, interactive }: { shape: Shape; interactive: boolean }) {
  const updateShape = useDoc((s) => s.updateShape);
  const setSelected = useUI((s) => s.setSelected);

  const select = () => {
    if (interactive) setSelected(shape.id);
  };

  const common = {
    id: shape.id,
    draggable: interactive,
    onMouseDown: select,
    onTouchStart: select,
  };

  switch (shape.type) {
    case 'rect':
      return (
        <Rect
          {...common}
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          strokeScaleEnabled={false}
          fill={shape.fill}
          onDragEnd={(e) => updateShape(shape.id, { x: e.target.x(), y: e.target.y() })}
          onTransformEnd={(e) => {
            const n = e.target;
            const width = Math.max(5, n.width() * n.scaleX());
            const height = Math.max(5, n.height() * n.scaleY());
            n.scaleX(1);
            n.scaleY(1);
            updateShape(shape.id, { x: n.x(), y: n.y(), width, height });
          }}
        />
      );

    case 'ellipse':
      // Stored as a bounding box; Konva positions ellipses by their centre.
      return (
        <Ellipse
          {...common}
          x={shape.x + shape.width / 2}
          y={shape.y + shape.height / 2}
          radiusX={shape.width / 2}
          radiusY={shape.height / 2}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          strokeScaleEnabled={false}
          fill={shape.fill}
          onDragEnd={(e) =>
            updateShape(shape.id, {
              x: e.target.x() - shape.width / 2,
              y: e.target.y() - shape.height / 2,
            })
          }
          onTransformEnd={(e) => {
            const n = e.target;
            const width = Math.max(5, n.width() * n.scaleX());
            const height = Math.max(5, n.height() * n.scaleY());
            n.scaleX(1);
            n.scaleY(1);
            updateShape(shape.id, { x: n.x() - width / 2, y: n.y() - height / 2, width, height });
          }}
        />
      );

    case 'line':
    case 'pen':
      return (
        <Line
          {...common}
          x={shape.x}
          y={shape.y}
          points={shape.points}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          hitStrokeWidth={Math.max(shape.strokeWidth, 14)}
          lineCap="round"
          lineJoin="round"
          tension={shape.type === 'pen' ? 0.4 : 0}
          onDragEnd={(e) => updateShape(shape.id, { x: e.target.x(), y: e.target.y() })}
        />
      );

    case 'text': {
      const edit = () => {
        const next = window.prompt('Edit text', shape.text);
        if (next !== null && next.trim()) updateShape(shape.id, { text: next });
      };
      return (
        <Text
          {...common}
          x={shape.x}
          y={shape.y}
          text={shape.text}
          fontSize={shape.fontSize}
          fill={shape.stroke}
          onDragEnd={(e) => updateShape(shape.id, { x: e.target.x(), y: e.target.y() })}
          onDblClick={edit}
          onDblTap={edit}
        />
      );
    }
  }
}

/* ---------- the board ---------- */

export default function Board() {
  const shapesMap = useDoc((s) => s.shapes);
  const addShape = useDoc((s) => s.addShape);
  const deleteShapes = useDoc((s) => s.deleteShapes);
  const replaceShapes = useDoc((s) => s.replaceShapes);
  const beginBatch = useDoc((s) => s.beginBatch);
  const endBatch = useDoc((s) => s.endBatch);
  const { tool, selectedId, style, eraserSize, eraserMode, view, setSelected, setView, zoomAt } = useUI();

  const shapes = useMemo(
    () => Object.values(shapesMap).sort((a, b) => a.z - b.z),
    [shapesMap],
  );
  const selected = selectedId ? shapesMap[selectedId] : undefined;
  const resizable = selected?.type === 'rect' || selected?.type === 'ellipse';

  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [draft, setDraft] = useState<Shape | null>(null); // shape being drawn (local only)

  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const eraserRingRef = useRef<Konva.Circle>(null);
  const drawing = useRef(false);
  const origin = useRef<Pt>({ x: 0, y: 0 });
  const lastErase = useRef<Pt>({ x: 0, y: 0 });

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Drop the selection if its shape disappeared (undo, erase, ...).
  useEffect(() => {
    if (selectedId && !shapesMap[selectedId]) setSelected(null);
  }, [selectedId, shapesMap, setSelected]);

  // Attach the transformer (selection box / resize handles) to the selected node.
  useEffect(() => {
    const stage = stageRef.current;
    const tr = trRef.current;
    if (!stage || !tr) return;
    const node =
      selectedId && tool === 'select'
        ? stage.findOne((n: Konva.Node) => n.id() === selectedId)
        : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, shapesMap, tool]);

  // Hide the eraser ring when another tool is picked.
  useEffect(() => {
    if (tool !== 'eraser') {
      eraserRingRef.current?.visible(false);
      eraserRingRef.current?.getLayer()?.batchDraw();
    }
  }, [tool]);

  /** Erase along the path a -> b (world coords), in the current eraser mode. */
  const eraseAlong = (a: Pt, b: Pt) => {
    const r = eraserSize / 2 / view.scale;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(r / 2, 1)));
    const original = useDoc.getState().shapes;

    if (eraserMode === 'stroke') {
      // Whole-stroke mode: anything the eraser touches is deleted.
      const all = Object.values(original);
      const hit = new Set<string>();
      for (let i = 0; i <= steps; i++) {
        const px = a.x + ((b.x - a.x) * i) / steps;
        const py = a.y + ((b.y - a.y) * i) / steps;
        for (const s of all) {
          if (!hit.has(s.id) && distToShape(s, px, py) <= r) hit.add(s.id);
        }
      }
      if (hit.size > 0) deleteShapes([...hit]);
      return;
    }

    // Partial mode: cut away only the part under the eraser. Work on a local copy and
    // commit once, so a whole eraser move is a single change to the document.
    const working = new Map(Object.entries(original));
    const touched = new Set<string>();
    const newId = () => crypto.randomUUID();
    for (let i = 0; i <= steps; i++) {
      const px = a.x + ((b.x - a.x) * i) / steps;
      const py = a.y + ((b.y - a.y) * i) / steps;
      for (const [id, s] of [...working]) {
        const result = erasePartial(s, px, py, r, view.scale, newId);
        if (!result) continue;
        working.delete(id);
        for (const piece of result) {
          working.set(piece.id, piece);
          touched.add(piece.id);
        }
      }
    }
    const removed = Object.keys(original).filter((id) => !working.has(id));
    const upserts = [...touched].filter((id) => working.has(id)).map((id) => working.get(id)!);
    if (removed.length > 0 || upserts.length > 0) replaceShapes(removed, upserts);
  };

  const onDown = (e: Evt) => {
    const stage = e.target.getStage();
    if (!stage) return;

    if (tool === 'select' || tool === 'hand') {
      if (tool === 'select' && e.target === stage) setSelected(null);
      return;
    }

    const pos = stage.getRelativePointerPosition();
    if (!pos) return;

    if (tool === 'eraser') {
      drawing.current = true;
      beginBatch(); // one drag of the eraser = one undo step
      lastErase.current = pos;
      eraseAlong(pos, pos);
      return;
    }

    if (tool === 'text') {
      const text = window.prompt('Text');
      if (text && text.trim()) {
        addShape({
          id: crypto.randomUUID(),
          z: Date.now(),
          type: 'text',
          x: pos.x,
          y: pos.y,
          stroke: style.stroke,
          strokeWidth: style.strokeWidth,
          text,
          fontSize: 24,
        });
      }
      return;
    }

    drawing.current = true;
    origin.current = pos;
    setSelected(null);
    const base = {
      id: crypto.randomUUID(),
      z: Date.now(),
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
    };
    if (tool === 'rect' || tool === 'ellipse') {
      setDraft({ ...base, type: tool, x: pos.x, y: pos.y, width: 0, height: 0, fill: style.fill });
    } else {
      setDraft({ ...base, type: tool, x: 0, y: 0, points: [pos.x, pos.y, pos.x, pos.y] });
    }
  };

  const onMove = (e: Evt) => {
    const stage = e.target.getStage();
    if (!stage) return;

    if (tool === 'eraser') {
      const pos = stage.getRelativePointerPosition();
      if (!pos) return;
      const ring = eraserRingRef.current;
      if (ring) {
        ring.position(pos);
        ring.visible(true);
        ring.getLayer()?.batchDraw();
      }
      if (drawing.current) {
        eraseAlong(lastErase.current, pos);
        lastErase.current = pos;
      }
      return;
    }

    if (!drawing.current) return;
    const pos = stage.getRelativePointerPosition();
    if (!pos) return;
    const o = origin.current;
    setDraft((d) => {
      if (!d) return d;
      if (d.type === 'rect' || d.type === 'ellipse') {
        return {
          ...d,
          x: Math.min(o.x, pos.x),
          y: Math.min(o.y, pos.y),
          width: Math.abs(pos.x - o.x),
          height: Math.abs(pos.y - o.y),
        };
      }
      if (d.type === 'line') return { ...d, points: [o.x, o.y, pos.x, pos.y] };
      if (d.type === 'pen') return { ...d, points: [...d.points, pos.x, pos.y] };
      return d;
    });
  };

  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (tool === 'eraser') {
      endBatch();
      return;
    }
    if (draft && isMeaningful(draft)) addShape(draft); // commit once, on release
    setDraft(null);
  };

  const onLeave = () => {
    eraserRingRef.current?.visible(false);
    eraserRingRef.current?.getLayer()?.batchDraw();
    onUp();
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    if (e.evt.ctrlKey || e.evt.metaKey) {
      // Ctrl/Cmd + wheel (or trackpad pinch) = zoom around the pointer.
      const p = stage.getPointerPosition();
      if (p) zoomAt(p.x, p.y, Math.exp(-e.evt.deltaY * 0.002));
    } else {
      // Plain wheel / two-finger scroll = pan.
      setView({ ...view, x: view.x - e.evt.deltaX, y: view.y - e.evt.deltaY });
    }
  };

  const cursor =
    tool === 'select'
      ? 'default'
      : tool === 'hand'
        ? 'grab'
        : tool === 'text'
          ? 'text'
          : tool === 'eraser'
            ? 'none' // the red ring below is the cursor
            : 'crosshair';
  const grid = 24 * view.scale;

  return (
    <div
      className="board"
      style={{
        cursor,
        backgroundImage: 'radial-gradient(#c3c9d4 1px, transparent 1px)',
        backgroundSize: `${grid}px ${grid}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={tool === 'select' || tool === 'hand'}
        onDragEnd={(e) => {
          if (e.target === e.target.getStage()) {
            setView({ ...view, x: e.target.x(), y: e.target.y() });
          }
        }}
        onWheel={onWheel}
        onMouseDown={onDown}
        onTouchStart={onDown}
        onMouseMove={onMove}
        onTouchMove={onMove}
        onMouseUp={onUp}
        onTouchEnd={onUp}
        onMouseLeave={onLeave}
      >
        <Layer>
          {shapes.map((s) => (
            <ShapeNode key={s.id} shape={s} interactive={tool === 'select'} />
          ))}
          {draft && (
            <Group listening={false}>
              <ShapeNode shape={draft} interactive={false} />
            </Group>
          )}
          <Transformer
            ref={trRef}
            rotateEnabled={false}
            flipEnabled={false}
            resizeEnabled={resizable}
            borderStroke="#3b5bdb"
            anchorStroke="#3b5bdb"
            boundBoxFunc={(oldBox, newBox) =>
              newBox.width < 5 || newBox.height < 5 ? oldBox : newBox
            }
          />
        </Layer>
        <Layer listening={false}>
          <Circle
            ref={eraserRingRef}
            radius={eraserSize / 2 / view.scale}
            stroke="#e03131"
            strokeWidth={1.5 / view.scale}
            fill="rgba(224, 49, 49, 0.08)"
            visible={false}
          />
        </Layer>
      </Stage>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Group, Rect, Ellipse, Line, Arrow, Text, Circle, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useDoc } from '../docStore';
import { useUI } from '../uiStore';
import { distToShape, erasePartial } from '../erase';
import { shapesInLasso, shapesInRect, unionBounds } from '../selection';
import { viewportRect, visibleShapes } from '../visible';
import type { LineShape, Shape } from '../types';
import MediaContent from './MediaContent';

type Evt = Konva.KonvaEventObject<MouseEvent | TouchEvent>;
interface Pt {
  x: number;
  y: number;
}

/** The Selection tool's in-progress drag: a rectangle, or a free-form loop. */
type Marquee =
  | { mode: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { mode: 'free'; pts: number[] };

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

function ShapeNode({
  shape,
  interactive,
  hidden = false,
  onEditText,
}: {
  shape: Shape;
  interactive: boolean;
  hidden?: boolean;
  onEditText?: (shape: Shape) => void;
}) {
  const updateShape = useDoc((s) => s.updateShape);
  const setSelected = useUI((s) => s.setSelected);

  const select = () => {
    if (interactive) setSelected(shape.id);
  };

  const common = {
    id: shape.id,
    visible: !hidden,
    draggable: interactive,
    onMouseDown: select,
    onTouchStart: select,
  };

  switch (shape.type) {
    case 'rect':
      if (shape.media || shape.note !== undefined) {
        const edit = () => {
          if (!interactive || shape.note === undefined) return;
          useUI.getState().requestEdit(shape.id);
        };
        return (
          <Group {...common} x={shape.x} y={shape.y} width={shape.width} height={shape.height}
            onDblClick={edit} onDblTap={edit}
            onDragEnd={(e) => updateShape(shape.id, { x: e.target.x(), y: e.target.y() })}
            onTransformEnd={(e) => {
              const n = e.target;
              const width = Math.max(40, shape.width * n.scaleX());
              const height = Math.max(40, shape.height * n.scaleY());
              n.scaleX(1); n.scaleY(1);
              updateShape(shape.id, { x: n.x(), y: n.y(), width, height }, 'transform');
            }}>
            <Rect width={shape.width} height={shape.height} fill={shape.fill} stroke={shape.stroke} strokeWidth={shape.strokeWidth} />
            {shape.media ? <MediaContent src={shape.media} width={shape.width} height={shape.height} /> :
              <Text text={shape.note} x={14} y={14} width={Math.max(1, shape.width - 28)} height={Math.max(1, shape.height - 28)} fontSize={20} fill={shape.stroke} wrap="word" listening={false} />}
          </Group>
        );
      }
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
            updateShape(shape.id, { x: n.x(), y: n.y(), width, height }, 'transform');
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
            updateShape(shape.id, { x: n.x() - width / 2, y: n.y() - height / 2, width, height }, 'transform');
          }}
        />
      );

    case 'line':
    case 'pen': {
      const lineProps = {
        ...common,
        x: shape.x,
        y: shape.y,
        points: shape.points,
        stroke: shape.stroke,
        strokeWidth: shape.strokeWidth,
        hitStrokeWidth: Math.max(shape.strokeWidth, 14),
        lineCap: 'round' as const,
        lineJoin: 'round' as const,
        tension: shape.type === 'pen' ? 0.4 : 0,
        onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) =>
          updateShape(shape.id, { x: e.target.x(), y: e.target.y() }),
        // Used for pens and multi-point lines; plain 2-point lines get endpoint handles instead.
        onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
          const n = e.target;
          const sx = n.scaleX();
          const sy = n.scaleY();
          n.scaleX(1);
          n.scaleY(1);
          updateShape(
            shape.id,
            {
              x: n.x(),
              y: n.y(),
              points: shape.points.map((v, i) => (i % 2 === 0 ? v * sx : v * sy)),
            },
            'transform',
          );
        },
      };
      if (shape.type === 'line' && shape.arrow) {
        const head = Math.max(12, shape.strokeWidth * 3.5);
        return <Arrow {...lineProps} fill={shape.stroke} pointerLength={head} pointerWidth={head} />;
      }
      return <Line {...lineProps} />;
    }

    case 'text': {
      const edit = () => onEditText?.(shape);
      return (
        <Text
          {...common}
          x={shape.x}
          y={shape.y}
          text={shape.text}
          fontSize={shape.fontSize}
          fill={shape.stroke}
          onDragEnd={(e) => updateShape(shape.id, { x: e.target.x(), y: e.target.y() })}
          onTransformEnd={(e) => {
            // Corner handles scale the font size.
            const n = e.target;
            const f = n.scaleY();
            n.scaleX(1);
            n.scaleY(1);
            updateShape(
              shape.id,
              {
                x: n.x(),
                y: n.y(),
                fontSize: Math.max(8, Math.round(shape.fontSize * f)),
              },
              'transform',
            );
          }}
          onDblClick={edit}
          onDblTap={edit}
        />
      );
    }
  }
}

/* ---------- the board ---------- */

export default function Board() {
  const [noteEditor, setNoteEditor] = useState<{ id: string; value: string } | null>(null);
  const shapesMap = useDoc((s) => s.shapes);
  const addShape = useDoc((s) => s.addShape);
  const deleteShapes = useDoc((s) => s.deleteShapes);
  const replaceShapes = useDoc((s) => s.replaceShapes);
  const beginBatch = useDoc((s) => s.beginBatch);
  const endBatch = useDoc((s) => s.endBatch);
  const updateShape = useDoc((s) => s.updateShape);
  const updateShapes = useDoc((s) => s.updateShapes);
  const {
    tool,
    selectedIds,
    marqueeMode,
    editRequest,
    style,
    eraserSize,
    eraserMode,
    view,
    setSelected,
    setSelection,
    requestEdit,
    setTool,
    setView,
    zoomAt,
  } = useUI();

  const shapes = useMemo(
    () => Object.values(shapesMap).sort((a, b) => a.z - b.z),
    [shapesMap],
  );
  const selectedList = useMemo(
    () => selectedIds.map((id) => shapesMap[id]).filter((s): s is Shape => !!s),
    [selectedIds, shapesMap],
  );
  const selectish = tool === 'select' || tool === 'marquee' || tool === 'move';
  const multi = selectedList.length > 1;
  const selected = selectedList.length === 1 ? selectedList[0] : undefined;
  // Several shapes selected: one draggable box over the whole group moves them together.
  const groupBounds = multi && selectish ? unionBounds(selectedList) : null;
  // A plain 2-point line / arrow is edited by dragging its two end handles, not a resize box.
  const endpointLine: LineShape | undefined =
    selected?.type === 'line' && selected.points.length === 4 ? selected : undefined;

  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [draft, setDraft] = useState<Shape | null>(null); // shape being drawn (local only)
  const [marquee, setMarquee] = useState<Marquee | null>(null); // selection drag (local only)
  const groupDrag = useRef<{ x: number; y: number; orig: Record<string, Pt> } | null>(null);

  // Inline text editor (a textarea floated over the canvas). Not shared with peers.
  interface Editor {
    key: number; // identifies one editing session so a stale blur can't close a newer one
    id: string | null; // existing text shape being edited, or null for a new one
    x: number; // world coords of the text's top-left
    y: number;
    value: string;
    fontSize: number;
    color: string;
  }
  const [editor, setEditor] = useState<Editor | null>(null);

  // Performance: only shapes near the screen are given to the canvas (see visible.ts). Selected
  // shapes and the one being edited are always drawn, so handles and the text editor work.
  const editingId = editor?.id;
  const always = useMemo(
    () => new Set<string>([...selectedIds, ...(editingId ? [editingId] : [])]),
    [selectedIds, editingId],
  );
  const vp = viewportRect(view, size.w, size.h);
  const drawn = useMemo(
    () => visibleShapes(shapes, vp, always),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shapes, vp.x, vp.y, vp.w, vp.h, always],
  );
  const editorRef = useRef<Editor | null>(null);
  const editorKey = useRef(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const stageRef = useRef<Konva.Stage>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef(false); // two fingers down: a pinch/pan gesture owns the touches
  const [pinching, setPinching] = useState(false);
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

  // Touch: two fingers pinch to zoom and drag to pan, whatever tool is active. (One finger keeps
  // its normal job: draw, select or pan with the Hand tool.) Done with pointer events on the
  // container; the second finger cancels whatever the first one started.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const fingers = new Map<number, Pt>();
    let prev: { d: number; mx: number; my: number } | null = null;

    const measure = () => {
      const [a, b] = [...fingers.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size === 2) {
        pinchRef.current = true;
        setPinching(true);
        if (drawing.current && useUI.getState().tool === 'eraser') endBatch(); // close its undo step
        drawing.current = false;
        setDraft(null);
        setMarquee(null);
        stageRef.current?.stopDrag();
        prev = measure();
      }
    };
    const move = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size >= 2 && prev) {
        const cur = measure();
        const ui = useUI.getState();
        ui.zoomAt(prev.mx, prev.my, cur.d / prev.d); // zoom about where the fingers were
        const v = useUI.getState().view;
        ui.setView({ ...v, x: v.x + (cur.mx - prev.mx), y: v.y + (cur.my - prev.my) }); // then pan
        prev = cur;
      }
    };
    const up = (e: PointerEvent) => {
      if (!fingers.delete(e.pointerId)) return;
      if (fingers.size < 2) prev = null;
      if (fingers.size === 0) {
        pinchRef.current = false;
        setPinching(false);
      }
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move, true);
    el.addEventListener('pointerup', up, true);
    el.addEventListener('pointercancel', up, true);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move, true);
      el.removeEventListener('pointerup', up, true);
      el.removeEventListener('pointercancel', up, true);
    };
  }, [endBatch]);

  // Drop the selection if its shape disappeared (undo, erase, ...).
  useEffect(() => {
    if (selectedIds.some((id) => !shapesMap[id])) {
      setSelection(selectedIds.filter((id) => shapesMap[id]));
    }
  }, [selectedIds, shapesMap, setSelection]);

  // Attach the transformer (selection box / resize handles) to the selected node.
  useEffect(() => {
    const stage = stageRef.current;
    const tr = trRef.current;
    if (!stage || !tr) return;
    const nodes =
      selectish && !endpointLine
        ? selectedIds
            .map((id) => stage.findOne((n: Konva.Node) => n.id() === id))
            .filter((n): n is Konva.Node => !!n)
        : [];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, shapesMap, selectish, endpointLine]);

  // Hide the eraser ring when another tool is picked.
  useEffect(() => {
    if (tool !== 'eraser') {
      eraserRingRef.current?.visible(false);
      eraserRingRef.current?.getLayer()?.batchDraw();
    }
  }, [tool]);

  const openEditor = (init: Omit<Editor, 'key'>) => {
    finishEditor(true);
    const ed = { ...init, key: ++editorKey.current };
    editorRef.current = ed;
    setEditor(ed);
  };

  /** Close the editor, saving (or discarding) its text. `key` ignores stale blur events. */
  const finishEditor = (save: boolean, key?: number) => {
    const ed = editorRef.current;
    if (!ed || (key !== undefined && key !== ed.key)) return;
    editorRef.current = null;
    setEditor(null);
    if (!save) return;
    const text = ed.value;
    if (ed.id) {
      if (text.trim()) updateShape(ed.id, { text });
      else deleteShapes([ed.id]); // emptied an existing label = delete it
    } else if (text.trim()) {
      const id = crypto.randomUUID();
      addShape({
        id,
        z: Date.now(),
        type: 'text',
        x: ed.x,
        y: ed.y,
        stroke: ed.color,
        strokeWidth: style.strokeWidth,
        text,
        fontSize: ed.fontSize,
      });
      setTool('select'); // done typing: select it so it can be moved / recoloured
      setSelected(id);
    }
  };

  const editText = (s: Shape) => {
    if (s.type !== 'text') return;
    openEditor({ id: s.id, x: s.x, y: s.y, value: s.text, fontSize: s.fontSize, color: s.stroke });
  };

  // Focus after the click that opened the editor finishes, otherwise the browser's
  // default mousedown focus change steals focus straight back and closes it.
  useEffect(() => {
    if (!editor) return;
    const t = window.setTimeout(() => {
      taRef.current?.focus();
      taRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [editor?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Edit this text" requested from the keyboard (Enter on a selected label).
  useEffect(() => {
    if (!editRequest) return;
    const s = useDoc.getState().shapes[editRequest];
    requestEdit(null);
    if (s?.type === 'rect' && s.note !== undefined) setNoteEditor({ id: s.id, value: s.note });
    else if (s) editText(s);
  }, [editRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Finish a Selection-tool drag: select whatever the rectangle / loop caught. */
  const finishMarquee = () => {
    const m = marquee;
    setMarquee(null);
    if (!m) return;
    const all = Object.values(useDoc.getState().shapes);
    if (m.mode === 'rect') {
      const r = { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), w: Math.abs(m.x1 - m.x0), h: Math.abs(m.y1 - m.y0) };
      // A bare click on empty canvas just clears the selection.
      const tiny = r.w * view.scale < 3 && r.h * view.scale < 3;
      setSelection(tiny ? [] : shapesInRect(all, r));
    } else {
      setSelection(shapesInLasso(all, m.pts));
    }
  };

  const moveGroup = (node: Konva.Node) => {
    const g = groupDrag.current;
    if (!g) return;
    const dx = node.x() - g.x;
    const dy = node.y() - g.y;
    const patches: Record<string, Partial<Shape>> = {};
    for (const [id, o] of Object.entries(g.orig)) patches[id] = { x: o.x + dx, y: o.y + dy };
    updateShapes(patches);
  };

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
    if (tool === 'laser') return; // draws nothing; peers see it through presence.ts
    if (pinchRef.current) return; // a second finger started a pinch: not a new stroke

    if (tool === 'select' || tool === 'move' || tool === 'hand') {
      if ((tool === 'select' || tool === 'move') && e.target === stage) setSelected(null);
      return;
    }

    if (tool === 'marquee') {
      // Pressing on a shape / handle is left to that node (select + drag it);
      // pressing on empty canvas starts a selection drag.
      if (e.target !== stage) return;
      const p = stage.getRelativePointerPosition();
      if (!p) return;
      drawing.current = true;
      setSelected(null);
      setMarquee(
        marqueeMode === 'rect'
          ? { mode: 'rect', x0: p.x, y0: p.y, x1: p.x, y1: p.y }
          : { mode: 'free', pts: [p.x, p.y] },
      );
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
      openEditor({ id: null, x: pos.x, y: pos.y, value: '', fontSize: 24, color: style.stroke });
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
    } else if (tool === 'arrow') {
      setDraft({ ...base, type: 'line', arrow: true, x: 0, y: 0, points: [pos.x, pos.y, pos.x, pos.y] });
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

    if (tool === 'marquee') {
      if (!drawing.current) return;
      const p = stage.getRelativePointerPosition();
      if (!p) return;
      setMarquee((m) =>
        !m ? m : m.mode === 'rect' ? { ...m, x1: p.x, y1: p.y } : { ...m, pts: [...m.pts, p.x, p.y] },
      );
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
    if (tool === 'marquee') {
      finishMarquee();
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
      : tool === 'move'
        ? 'move'
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
      ref={boardRef}
      className="board"
      role="region"
      aria-label="Whiteboard canvas"
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
        draggable={!pinching && (tool === 'select' || tool === 'hand')}
        onDragStart={() => useUI.getState().setFollow(null)}
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
          {drawn.map((s) => (
            <ShapeNode
              key={s.id}
              shape={s}
              interactive={selectish && !multi}
              hidden={editor?.id === s.id}
              onEditText={selectish ? editText : undefined}
            />
          ))}
          {draft && (
            <Group listening={false}>
              <ShapeNode shape={draft} interactive={false} />
            </Group>
          )}
          {groupBounds && (
            <Rect
              x={groupBounds.x}
              y={groupBounds.y}
              width={groupBounds.w}
              height={groupBounds.h}
              fill="rgba(59, 91, 219, 0.05)"
              stroke="#3b5bdb"
              strokeWidth={1 / view.scale}
              dash={[6 / view.scale, 4 / view.scale]}
              draggable
              onDragStart={(e) => {
                beginBatch(); // the whole group drag = one undo step
                groupDrag.current = {
                  x: e.target.x(),
                  y: e.target.y(),
                  orig: Object.fromEntries(selectedList.map((s) => [s.id, { x: s.x, y: s.y }])),
                };
              }}
              onDragMove={(e) => moveGroup(e.target)}
              onDragEnd={(e) => {
                moveGroup(e.target);
                endBatch();
                groupDrag.current = null;
              }}
            />
          )}
          {selectish &&
            endpointLine &&
            [0, 1].map((i) => (
              <Circle
                key={i}
                x={endpointLine.x + endpointLine.points[i * 2]}
                y={endpointLine.y + endpointLine.points[i * 2 + 1]}
                radius={6 / view.scale}
                fill="#fff"
                stroke="#3b5bdb"
                strokeWidth={2 / view.scale}
                draggable
                onDragMove={(e) => {
                  const points = [...endpointLine.points];
                  points[i * 2] = e.target.x() - endpointLine.x;
                  points[i * 2 + 1] = e.target.y() - endpointLine.y;
                  updateShape(endpointLine.id, { points }, `endpoint:${endpointLine.id}:${i}`);
                }}
              />
            ))}
          <Transformer
            ref={trRef}
            rotateEnabled={false}
            flipEnabled={false}
            keepRatio={selected?.type === 'text'}
            enabledAnchors={
              selected?.type === 'text'
                ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
                : undefined
            }
            borderStroke="#3b5bdb"
            anchorStroke="#3b5bdb"
            boundBoxFunc={(oldBox, newBox) =>
              newBox.width < 5 || newBox.height < 5 ? oldBox : newBox
            }
          />
        </Layer>
        <Layer listening={false}>
          {/* Small crosshair marking the world origin (0, 0) */}
          <Line points={[-10 / view.scale, 0, 10 / view.scale, 0]} stroke="#8b95a7" strokeWidth={1.5 / view.scale} />
          <Line points={[0, -10 / view.scale, 0, 10 / view.scale]} stroke="#8b95a7" strokeWidth={1.5 / view.scale} />
          {marquee?.mode === 'rect' && (
            <Rect
              x={Math.min(marquee.x0, marquee.x1)}
              y={Math.min(marquee.y0, marquee.y1)}
              width={Math.abs(marquee.x1 - marquee.x0)}
              height={Math.abs(marquee.y1 - marquee.y0)}
              fill="rgba(59, 91, 219, 0.08)"
              stroke="#3b5bdb"
              strokeWidth={1 / view.scale}
              dash={[6 / view.scale, 4 / view.scale]}
            />
          )}
          {marquee?.mode === 'free' && (
            <Line
              points={marquee.pts}
              closed
              fill="rgba(59, 91, 219, 0.08)"
              stroke="#3b5bdb"
              strokeWidth={1.5 / view.scale}
              dash={[6 / view.scale, 4 / view.scale]}
              lineJoin="round"
            />
          )}
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
      {selectish && selected?.type === 'rect' && selected.note !== undefined && (
        <button className="btn wide" style={{ position: 'absolute', bottom: 80, left: 16, zIndex: 12 }}
          onClick={() => setNoteEditor({ id: selected.id, value: selected.note! })}>✏️ Edit sticky note</button>
      )}
      {noteEditor && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#0006', display: 'grid', placeItems: 'center' }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setNoteEditor(null); }}>
          <form role="dialog" aria-modal="true" aria-label="Edit sticky note"
            style={{ background: 'white', padding: 20, borderRadius: 12, width: 'min(420px, 90vw)' }}
            onSubmit={(e) => { e.preventDefault(); if (useDoc.getState().shapes[noteEditor.id]) updateShape(noteEditor.id, { note: noteEditor.value }); setNoteEditor(null); }}>
            <label>📝 Sticky note
              <textarea autoFocus aria-label="Sticky note text" maxLength={10000} rows={7} value={noteEditor.value}
                style={{ display: 'block', width: '100%', fontSize: 16, margin: '12px 0' }}
                onChange={(e) => setNoteEditor({ ...noteEditor, value: e.target.value })} />
            </label>
            <button className="btn wide" type="button" onClick={() => setNoteEditor(null)}>Cancel</button>
            <button className="btn wide" type="submit">Save</button>
          </form>
        </div>
      )}
      {editor?.id && (
        <button
          className="text-editor-del"
          title="Delete this text"
          aria-label="Delete this text"
          style={{
            left: view.x + editor.x * view.scale,
            top: view.y + editor.y * view.scale - 30,
          }}
          onMouseDown={(e) => e.preventDefault()} // keep focus so the editor doesn't commit first
          onClick={() => {
            const id = editor.id!;
            editorRef.current = null;
            setEditor(null);
            deleteShapes([id]);
          }}
        >
          🗑 Delete
        </button>
      )}
      {editor && (
        <textarea
          key={editor.key}
          ref={taRef}
          className="text-editor"
          value={editor.value}
          rows={Math.max(1, editor.value.split('\n').length)}
          spellCheck={false}
          style={{
            left: view.x + editor.x * view.scale,
            top: view.y + editor.y * view.scale,
            fontSize: editor.fontSize * view.scale,
            width: `${Math.max(3, ...editor.value.split('\n').map((l) => l.length)) + 1}ch`,
            color: editor.color,
          }}
          onChange={(e) => {
            const next = { ...editor, value: e.target.value };
            editorRef.current = next;
            setEditor(next);
          }}
          onBlur={() => finishEditor(true, editor.key)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') finishEditor(false);
            else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              finishEditor(true);
            }
          }}
        />
      )}
    </div>
  );
}

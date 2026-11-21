import { useEffect } from 'react';
import Board from './components/Board';
import Toolbar from './components/Toolbar';
import { useDoc } from './docStore';
import { useUI } from './uiStore';
import type { Tool } from './types';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  p: 'pen',
  t: 'text',
  e: 'eraser',
};

const ARROWS: Record<string, [number, number]> = {
  arrowleft: [-1, 0],
  arrowright: [1, 0],
  arrowup: [0, -1],
  arrowdown: [0, 1],
};

export default function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing =
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        (el instanceof HTMLInputElement && el.type === 'text');
      if (typing) return;

      const ui = useUI.getState();
      const doc = useDoc.getState();
      const key = e.key.toLowerCase();

      // Ctrl / Cmd shortcuts
      if (e.ctrlKey || e.metaKey) {
        const centre = [window.innerWidth / 2, window.innerHeight / 2] as const;
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) doc.redo();
          else doc.undo();
        } else if (key === 'y') {
          e.preventDefault();
          doc.redo();
        } else if (key === 'd') {
          e.preventDefault();
          ui.duplicateSelected();
        } else if (key === '0') {
          e.preventDefault();
          ui.resetView();
        } else if (key === '=' || key === '+') {
          e.preventDefault();
          ui.zoomAt(centre[0], centre[1], 1.2);
        } else if (key === '-') {
          e.preventDefault();
          ui.zoomAt(centre[0], centre[1], 1 / 1.2);
        }
        return;
      }
      if (e.altKey) return;

      if (TOOL_KEYS[key]) {
        ui.setTool(TOOL_KEYS[key]);
      } else if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        ui.deleteSelected();
      } else if (key === 'escape') {
        ui.setSelected(null);
      } else if (key === ']') {
        ui.bringToFront();
      } else if (key === '[') {
        ui.sendToBack();
      } else if (ARROWS[key]) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        ui.nudgeSelected(ARROWS[key][0] * step, ARROWS[key][1] * step);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <Board />
      <Toolbar />
    </>
  );
}

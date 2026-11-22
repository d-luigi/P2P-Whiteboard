import { useEffect } from 'react';
import Board from './components/Board';
import Toolbar from './components/Toolbar';
import Presence from './components/Presence';
import Toasts from './components/Toasts';
import PasswordGate from './components/PasswordGate';
import Shortcuts from './components/Shortcuts';
import EmptyState from './components/EmptyState';
import DeleteDialog from './components/DeleteDialog';
import AuthDialog from './components/AuthDialog';
import DeletedScreen from './components/DeletedScreen';
import { useOwner } from './owner';
import A11y from './components/A11y';
import { readOnly } from './board';
import { RemoteCursors, LaserCanvas } from './components/Cursors';
import { useDoc } from './docStore';
import { useUI } from './uiStore';
import type { Tool } from './types';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  m: 'marquee',
  h: 'hand',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  a: 'arrow',
  p: 'pen',
  t: 'text',
  e: 'eraser',
  k: 'laser',
};

const ARROWS: Record<string, [number, number]> = {
  arrowleft: [-1, 0],
  arrowright: [1, 0],
  arrowup: [0, -1],
  arrowdown: [0, 1],
};

export default function App() {
  const status = useDoc((s) => s.status);
  const deleted = useOwner((s) => s.deleted);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing =
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'color', 'range', 'file'].includes(el.type));
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
      } else if (key === 'enter') {
        // Enter on a single selected label opens its text editor.
        const [only] = ui.selectedIds;
        if (ui.selectedIds.length === 1 && doc.shapes[only]?.type === 'text') {
          e.preventDefault();
          ui.requestEdit(only);
        }
      } else if (key === '?') {
        e.preventDefault();
        ui.setHelp(!ui.helpOpen);
      } else if (key === 'home') {
        e.preventDefault();
        ui.goHome();
      } else if (key === 'escape') {
        ui.setSelection([]);
        ui.setFollow(null);
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

  // The owner deleted this board: nothing else is shown (and nothing is saved or synced).
  if (deleted) return <DeletedScreen />;

  // Wait for the saved board to load from IndexedDB, so the first thing drawn is the
  // real board (not an empty one that is then replaced).
  if (status === 'loading') {
    return (
      <div className="loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        Loading board…
      </div>
    );
  }

  return (
    <>
      <Board />
      <RemoteCursors />
      <LaserCanvas />
      <Toolbar />
      <Presence />
      <EmptyState />
      <PasswordGate />
      <Shortcuts />
      <DeleteDialog />
      <AuthDialog />
      <Toasts />
      <A11y />
      {readOnly && (
        <div className="viewonly" role="status">
          👁 View-only: you can look around and use the laser pointer
        </div>
      )}
      {status === 'memory' && (
        <div className="banner" role="alert">
          Can't save in this browser (private window or blocked storage). You can still draw,
          but this board will be lost when you close the tab.
        </div>
      )}
    </>
  );
}

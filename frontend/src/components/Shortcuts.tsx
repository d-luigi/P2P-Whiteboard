import { useUI } from '../uiStore';

const ROWS: [string, string][] = [
  ['V · M · H', 'Select · Marquee select · Hand (pan)'],
  ['R · O · L · A', 'Rectangle · Ellipse · Line · Arrow'],
  ['P · T · E', 'Pen · Text · Eraser'],
  ['K', 'Laser pointer (hold to show others where you point)'],
  ['Ctrl+Z · Ctrl+Shift+Z', 'Undo · Redo'],
  ['Delete', 'Delete selection'],
  ['Ctrl+D', 'Duplicate selection'],
  ['Arrow keys (Shift = ×10)', 'Nudge selection'],
  [']  ·  [', 'Bring to front · Send to back'],
  ['Enter', 'Edit the selected text'],
  ['Ctrl + / Ctrl −', 'Zoom in / out'],
  ['Ctrl+0', 'Reset zoom and go to the centre'],
  ['Home', 'Go back to (0, 0)'],
  ['Esc', 'Clear selection · stop following'],
  ['?', 'Show / hide this list'],
];

/** The keyboard shortcuts list. Opens from the board menu or with "?". */
export default function Shortcuts() {
  const open = useUI((s) => s.helpOpen);
  const setHelp = useUI((s) => s.setHelp);
  if (!open) return null;
  return (
    <div className="gate" role="dialog" aria-modal="true" aria-labelledby="keys-title" onKeyDown={(e) => e.key === 'Escape' && setHelp(false)}>
      <div className="gate-card wide">
        <h2 id="keys-title">Keyboard shortcuts</h2>
        <p>
          Touch: one finger draws or pans (Hand tool); two fingers pinch to zoom and drag to pan.
        </p>
        <dl className="keys">
          {ROWS.map(([k, d]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
        <button className="share-btn" autoFocus onClick={() => setHelp(false)}>
          Close
        </button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useDoc } from '../docStore';
import { usePresence } from '../presence';
import { useSync, connectionStatus } from '../sync';

/**
 * Screen-reader support for a canvas app: announces people joining / leaving and connection
 * changes, and exposes the board's text labels as a list (the drawing itself has no text form).
 */
export default function A11y() {
  const peers = usePresence((s) => s.peers);
  const status = useSync(connectionStatus);
  const shapes = useDoc((s) => s.shapes);
  const [message, setMessage] = useState('');
  const known = useRef<Map<number, string> | null>(null);
  const lastStatus = useRef(status);

  useEffect(() => {
    const now = new Map(peers.map((p) => [p.id, p.name]));
    const before = known.current;
    known.current = now;
    if (!before) return;
    const joined = [...now].filter(([id]) => !before.has(id)).map(([, n]) => n);
    const left = [...before].filter(([id]) => !now.has(id)).map(([, n]) => n);
    const parts = [...joined.map((n) => `${n} joined`), ...left.map((n) => `${n} left`)];
    if (parts.length) setMessage(parts.join('. '));
  }, [peers]);

  useEffect(() => {
    if (lastStatus.current !== status) {
      lastStatus.current = status;
      setMessage(`Connection: ${status}`);
    }
  }, [status]);

  const all = Object.values(shapes);
  const labels = all.filter((s) => s.type === 'text').slice(0, 100);

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {message}
      </div>
      <section className="sr-only" aria-label="Board contents">
        <p>
          {all.length} {all.length === 1 ? 'shape' : 'shapes'} on the board, {labels.length} text{' '}
          {labels.length === 1 ? 'label' : 'labels'}.
        </p>
        <ul>
          {labels.map((s) => (
            <li key={s.id}>{s.type === 'text' ? s.text.slice(0, 200) : ''}</li>
          ))}
        </ul>
      </section>
    </>
  );
}

import { useRef, useState } from 'react';
import { boardStats, compactBoard, type BoardStats } from '../docStore';
import { downloadBackup, importBackupFile } from '../backup';
import { readOnly } from '../board';
import { useUI } from '../uiStore';
import { toast } from '../toast';

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** ⋯ menu: backup, import, compaction, keyboard shortcuts. */
export default function BoardMenu() {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<BoardStats | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const setHelp = useUI((s) => s.setHelp);

  const toggle = () => {
    if (!open) {
      try {
        setStats(boardStats());
      } catch {
        setStats(null);
      }
    }
    setOpen((o) => !o);
  };

  const run = async (fn: () => Promise<void> | void, failure: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : failure, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="boardmenu">
      <button
        className="btn"
        title="Board menu: backup, import, shortcuts"
        aria-label="Board menu"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={toggle}
      >
        ⋯
      </button>
      {open && (
        <div className="goto-pop menu" role="menu" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          {stats && (
            <div className="menu-stat" role="presentation">
              {stats.shapes} {stats.shapes === 1 ? 'shape' : 'shapes'} · {kb(stats.bytes)} saved
            </div>
          )}
          <button
            role="menuitem"
            className="menu-item"
            onClick={() => run(() => downloadBackup(), 'The backup could not be created.')}
          >
            Download backup (.p2pwb)
          </button>
          {!readOnly && (
            <>
              <button role="menuitem" className="menu-item" disabled={busy} onClick={() => fileRef.current?.click()}>
                Import backup…
              </button>
              <button
                role="menuitem"
                className="menu-item"
                disabled={busy}
                title="Frees space used by deleted items. Resets the undo history."
                onClick={() => {
                  if (!window.confirm('Compact this board? This frees space used by deleted items and resets the undo history. The page will reload.')) return;
                  run(() => compactBoard(), 'Compacting failed.');
                }}
              >
                Compact board…
              </button>
            </>
          )}
          <button
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              setHelp(true);
            }}
          >
            Keyboard shortcuts (?)
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".p2pwb,application/octet-stream"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              run(async () => {
                const n = await importBackupFile(file);
                toast(`Imported ${n} ${n === 1 ? 'shape' : 'shapes'}. Ctrl+Z undoes it.`);
                setOpen(false);
              }, 'That file could not be imported.');
            }}
          />
        </div>
      )}
    </div>
  );
}

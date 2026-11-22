import { useEffect, useRef, useState } from 'react';
import { boardStats, compactBoard, type BoardStats } from '../docStore';
import { downloadBackup, importBackupFile } from '../backup';
import { readOnly } from '../board';
import { useUI } from '../uiStore';
import { toast } from '../toast';
import { claimOwnership, useOwner } from '../owner';
import { setPanelOpen } from '../account';
import { installApp, usePwa } from '../pwa';

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * ⋯ menu: backup, import, compaction, keyboard shortcuts.
 * `inline` renders the same items as a plain list (used inside the phone dropdown),
 * with no ⋯ button and no popover of its own.
 */
export default function BoardMenu({ inline = false, onDone }: { inline?: boolean; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<BoardStats | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const setHelp = useUI((s) => s.setHelp);
  const setDeleteDialog = useUI((s) => s.setDeleteDialog);
  const isOwner = useOwner((s) => s.isOwner);
  const ownerHash = useOwner((s) => s.ownerHash);
  const canInstall = usePwa((s) => s.canInstall);

  const loadStats = () => {
    try {
      setStats(boardStats());
    } catch {
      setStats(null);
    }
  };

  useEffect(() => {
    if (inline) loadStats();
  }, [inline]);

  const toggle = () => {
    if (!open) loadStats();
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

  const shown = inline || open;
  const close = () => {
    setOpen(false);
    onDone?.();
  };

  return (
    <div className={inline ? 'boardmenu inline' : 'boardmenu'}>
      {!inline && (
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
      )}
      {shown && (
        <div
          className={inline ? 'menu-list' : 'goto-pop menu'}
          role="menu"
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        >
          {stats && (
            <div className="menu-stat" role="presentation">
              {stats.shapes} {stats.shapes === 1 ? 'shape' : 'shapes'} · {kb(stats.bytes)} saved
            </div>
          )}
          <div className="menu-stat" role="presentation">
            {isOwner ? '👑 You are an owner of this board' : ownerHash ? 'This board has an owner' : 'This board has no owner yet'}
          </div>
          <button
            role="menuitem"
            className="menu-item"
            onClick={() => {
              close();
              setPanelOpen(true);
            }}
          >
            My boards &amp; account…
          </button>
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
          {canInstall && (
            <button
              role="menuitem"
              className="menu-item"
              title="Add the whiteboard to your device so it opens like an app, even offline"
              onClick={() => {
                close();
                void installApp();
              }}
            >
              Install app…
            </button>
          )}
          {!inline && (
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
          )}
          {!readOnly && !ownerHash && (
            <button
              role="menuitem"
              className="menu-item"
              title="Boards made before owners existed have none. The first person to claim it becomes its owner."
              onClick={() => {
                toast(
                  claimOwnership()
                    ? 'You now own this board. Share an owner link from Share to add co-owners.'
                    : 'Not yet: the board is still syncing, or it already has an owner. Try again in a moment.',
                );
                close();
              }}
            >
              Claim ownership
            </button>
          )}
          {!readOnly && isOwner && (
            <button
              role="menuitem"
              className="menu-item danger"
              onClick={() => {
                close();
                setDeleteDialog('everyone');
              }}
            >
              Delete board for everyone…
            </button>
          )}
          <button
            role="menuitem"
            className="menu-item"
            title="Erases only the copy saved in this browser"
            onClick={() => {
              close();
              setDeleteDialog('local');
            }}
          >
            Remove from this device…
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
                onDone?.();
              }, 'That file could not be imported.');
            }}
          />
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { openDialog, signOut, syncNow, useAccount } from '../account';
import { myBoards, openEntry, removeFromList, renameBoard, useRegistry } from '../registry';
import { boardId, newBoard } from '../board';
import { toast } from '../toast';
import '../account.css';

const ago = (t: number) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

/** Bottom-right panel: the boards you have opened, and your account (or guest) status. */
export default function AccountPanel({ onClose }: { onClose: () => void }) {
  const entries = useRegistry((s) => s.entries);
  const { configured, session, sync, syncError } = useAccount();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const boards = myBoards(entries);

  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const leave = async () => {
    if (!window.confirm('Sign out? Your board list and owner keys are removed from this device (your account keeps them), and the page reloads. The boards themselves stay saved in this browser.')) return;
    setBusy(true);
    try {
      await signOut();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not sign out.', 'error');
      setBusy(false);
    }
  };

  return (
    <div className="presence-panel account-panel" role="dialog" aria-label="My boards and account" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="panel-title">My boards</div>

      {boards.length === 0 ? (
        <p className="empty">Boards you open will be listed here.</p>
      ) : (
        <ul className="board-list">
          {boards.map((b) => (
            <li key={b.id} className={b.id === boardId ? 'current' : ''}>
              {editing === b.id ? (
                <input
                  className="name-input"
                  autoFocus
                  maxLength={80}
                  defaultValue={b.title}
                  aria-label="Board name"
                  onBlur={(e) => {
                    renameBoard(b.id, e.target.value);
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setEditing(null);
                    }
                  }}
                />
              ) : (
                <button className="board-open" title={b.id === boardId ? 'This board' : 'Open this board'} onClick={() => b.id !== boardId && openEntry(b)}>
                  <span className="board-title">{b.title}</span>
                  <span className="board-meta">
                    {b.role === 'owner' && <span title="You own this board">👑 </span>}
                    {b.viewOnly && <span title="View-only link">👁 </span>}
                    {b.passwordProtected && <span title="Password protected">🔒 </span>}
                    {b.id === boardId ? 'open now' : ago(b.openedAt)}
                  </span>
                </button>
              )}
              <button className="chip-btn mini" aria-label={`Rename ${b.title}`} title="Rename (only you see names)" onClick={() => setEditing(b.id)}>
                ✎
              </button>
              <button
                className="chip-btn mini"
                aria-label={`Remove ${b.title} from my list`}
                title="Remove from this list (the board itself is not deleted)"
                onClick={() => removeFromList(b.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="chip-btn block" onClick={newBoard}>
        ＋ New board
      </button>

      <div className="account-box">
        {session ? (
          <>
            <div className="panel-title">Signed in</div>
            <div className="account-email">{session.email ?? 'Your account'}</div>
            <p className="hint" role="status">
              {sync === 'syncing' && 'Syncing…'}
              {sync === 'ok' && 'Your boards are in sync.'}
              {sync === 'idle' && 'Waiting to sync.'}
              {sync === 'error' && `Not synced: ${syncError ?? 'try again'}`}
            </p>
            <div className="pw-actions">
              <button className="chip-btn" disabled={sync === 'syncing'} onClick={() => void syncNow().catch(() => undefined)}>
                Sync now
              </button>
              <button className="chip-btn" disabled={busy} onClick={leave}>
                Sign out
              </button>
            </div>
          </>
        ) : configured ? (
          <>
            <div className="panel-title">Using as a guest</div>
            <p className="hint">This list is saved on this device only. Create an account to keep it on all your devices.</p>
            <div className="pw-actions">
              <button className="share-btn" onClick={() => openDialog('signup')}>
                Create account
              </button>
              <button className="chip-btn" onClick={() => openDialog('signin')}>
                Sign in
              </button>
            </div>
          </>
        ) : (
          <p className="hint">This list is saved on this device only. Accounts are not enabled on this site.</p>
        )}
      </div>

      <button className="chip-btn close" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

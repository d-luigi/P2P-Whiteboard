import { useState } from 'react';
import { useUI } from '../uiStore';
import { deleteBoardForEveryone, removeFromDevice } from '../owner';
import { toast } from '../toast';
import '../ownership.css';

/** Confirmation for the two ways to get rid of a board: for everyone (owners) or this device. */
export default function DeleteDialog() {
  const mode = useUI((s) => s.deleteDialog);
  const setMode = useUI((s) => s.setDeleteDialog);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  if (!mode) return null;
  const everyone = mode === 'everyone';
  const confirmed = !everyone || typed.trim().toUpperCase() === 'DELETE';

  const close = () => {
    setMode(null);
    setTyped('');
  };

  const confirm = async () => {
    setBusy(true);
    try {
      if (everyone) deleteBoardForEveryone(); // the deleted screen takes over from here
      else await removeFromDevice(); // opens a fresh board
      close();
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : 'That did not work.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="gate"
      role="presentation"
      onKeyDown={(e) => e.key === 'Escape' && !busy && close()}
    >
      <div className="gate-card" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <h2 id="delete-title">
          {everyone ? 'Delete this board for everyone?' : 'Remove this board from this device?'}
        </h2>

        {everyone ? (
          <>
            <p>
              Everyone who is connected right now loses the board, and so does this device. Nobody
              can open it from its link afterwards. This can't be undone.
            </p>
            <p className="hint">
              There is no server, so a device that is offline right now may keep its own copy until
              it next connects.
            </p>
            <label className="confirm-field">
              Type <strong>DELETE</strong> to confirm
              <input
                type="text"
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </label>
          </>
        ) : (
          <p>
            This erases the copy saved in this browser. People you shared the board with keep
            theirs, and you can join again later from its link while someone else still has it.
          </p>
        )}

        <div className="gate-actions">
          <button className="chip-btn danger" disabled={!confirmed || busy} onClick={confirm}>
            {everyone ? 'Delete for everyone' : 'Remove from this device'}
          </button>
          <button className="chip-btn" autoFocus={!everyone} disabled={busy} onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

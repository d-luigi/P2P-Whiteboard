import { useState } from 'react';
import { getOwnerKey, ownerLink, passwordProtected, passwordsSupported, readOnly, setPassword, shareLink } from '../board';
import { useOwner } from '../owner';
import { copyText } from '../backup';
import { toast } from '../toast';

/** Share links and the optional password. Opens from the Share button (Presence.tsx). */
export default function ShareDialog({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState('');
  const isOwner = useOwner((s) => s.isOwner);

  const copyOwner = async () => {
    const key = getOwnerKey();
    if (key && (await copyText(ownerLink(key), 'the owner link'))) {
      toast('Owner link copied. Whoever opens it becomes an owner.');
    }
  };

  const copy = async (kind: 'edit' | 'view') => {
    if (await copyText(shareLink(kind), kind === 'edit' ? 'the edit link' : 'the view-only link')) {
      toast(kind === 'edit' ? 'Edit link copied.' : 'View-only link copied.');
    }
  };

  return (
    <div
      className="presence-panel share-panel"
      role="dialog"
      aria-label="Share this board"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="panel-title">Share this board</div>

      {!readOnly && (
        <>
          <button className="share-btn block" autoFocus onClick={() => copy('edit')}>
            Copy edit link
          </button>
          <p className="hint">Anyone with this link can edit. Only send it to people you trust.</p>
        </>
      )}
      <button className={`chip-btn block ${readOnly ? 'primary' : ''}`} onClick={() => copy('view')}>
        Copy view-only link
      </button>
      <p className="hint">
        Opens without editing tools. This is a courtesy, not a lock: there is no server to enforce it,
        so a determined person could still edit their own copy.
      </p>

      {!readOnly && isOwner && (
        <>
          <button className="chip-btn block" onClick={copyOwner}>
            Copy owner link
          </button>
          <p className="hint">
            Gives someone the same powers as you, including deleting the board for everyone. Only send
            it to people you trust as co-owners.
          </p>
        </>
      )}

      {!readOnly && (
        <div className="pw">
          <div className="panel-title">Password {passwordProtected && '🔒'}</div>
          {!passwordsSupported ? (
            <p className="hint">Passwords need a secure address (https:// or localhost).</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (pw.trim()) setPassword(pw);
              }}
            >
              <label className="field">
                <span className="sr-only">Board password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder={passwordProtected ? 'New password' : 'Require a password'}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                />
              </label>
              <div className="pw-actions">
                <button type="submit" className="chip-btn" disabled={!pw.trim()}>
                  {passwordProtected ? 'Change' : 'Set password'}
                </button>
                {passwordProtected && (
                  <button type="button" className="chip-btn" onClick={() => setPassword(null)}>
                    Remove
                  </button>
                )}
              </div>
              <p className="hint">
                People without it can't connect. Share it separately from the link. Setting it reloads
                this page; anyone already connected stays connected until they reload. It protects live
                sharing, not the copy saved in a browser.
              </p>
            </form>
          )}
        </div>
      )}
      <button className="chip-btn close" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

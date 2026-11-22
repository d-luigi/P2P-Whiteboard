import { useState } from 'react';
import { createPortal } from 'react-dom';
import { boardId, passwordProtected, readOnly } from '../board';
import { joinFragment } from '../joinBoard';

export default function JoinBoard() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const currentCode = boardId + (passwordProtected ? '.pw' : '') + (readOnly ? '.view' : '');
  return <>
    <button className="btn wide" onClick={() => { setError(''); setOpen(true); }}>🚪 Join board</button>
    {open && createPortal(
      <div className="gate" role="dialog" aria-modal="true" aria-labelledby="join-board-title"
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setOpen(false); }}>
        <form className="gate-card" onSubmit={(e) => {
          e.preventDefault();
          const fragment = joinFragment(code);
          if (!fragment) { setError('Enter the full board code or share link.'); return; }
          setOpen(false);
          location.hash = fragment;
        }}>
          <h2 id="join-board-title">Join a board</h2>
          <p>Paste the full code or share link from the host. Protected codes include .pw and will ask for a password.</p>
          <input autoFocus aria-label="Board code or link" placeholder="Board code or share link" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          {error && <p role="alert">{error}</p>}
          <div className="gate-actions"><button className="share-btn" type="submit" disabled={!code.trim()}>Join</button>
            <button className="chip-btn" type="button" onClick={() => setOpen(false)}>Cancel</button></div>
          <p>Code for this board:</p>
          <input aria-label="Current board code" readOnly value={currentCode} onFocus={(e) => e.target.select()} />
          <button className="chip-btn" type="button" onClick={async () => {
            try { await navigator.clipboard.writeText(currentCode); setCopied(true); }
            catch { setError('Select the code above and copy it.'); }
          }}>{copied ? '✓ Copied' : '📋 Copy board code'}</button>
        </form>
      </div>, document.body)}
  </>;
}

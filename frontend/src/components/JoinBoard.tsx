import { useState } from 'react';
import { createPortal } from 'react-dom';
import { requestRoomCode, useRoomCode } from '../roomCodes';
import { joinFragment } from '../joinBoard';

export default function JoinBoard() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const { code: currentCode, error: codeError } = useRoomCode();
  const [joining, setJoining] = useState(false);
  return <>
    <button className="btn wide" onClick={() => { setError(''); setOpen(true); }}>🚪 Join board</button>
    {open && createPortal(
      <div className="gate" role="dialog" aria-modal="true" aria-labelledby="join-board-title"
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setOpen(false); }}>
        <form className="gate-card" onSubmit={async (e) => {
          e.preventDefault();
          if (joining) return;
          setJoining(true);
          setError('');
          try {
            const input = code.trim();
            const resolved = /^[a-z0-9]{6}$/i.test(input)
              ? await requestRoomCode('room-resolve', input.toUpperCase())
              : input;
            const fragment = joinFragment(resolved);
            if (!fragment) throw new Error('Enter a six-character room code or a share link.');
            setOpen(false);
            location.hash = fragment;
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not join this board.');
          } finally { setJoining(false); }
        }}>
          <h2 id="join-board-title">Join a board</h2>
          <p>Enter the host’s six-character code. Password-protected boards will ask for a password.</p>
          <input autoFocus aria-label="Board code or link" placeholder="e.g. ABC234" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
          {error && <p role="alert">{error}</p>}
          <div className="gate-actions"><button className="share-btn" type="submit" disabled={!code.trim() || joining}>{joining ? 'Joining…' : 'Join'}</button>
            <button className="chip-btn" type="button" disabled={joining} onClick={() => setOpen(false)}>Cancel</button></div>
          <p>Code for this board:</p>
          <input aria-label="Current board code" readOnly value={currentCode} onFocus={(e) => e.target.select()} />
          {codeError && <p role="status">{codeError}</p>}
          <button className="chip-btn" type="button" disabled={!currentCode} onClick={async () => {
            try { await navigator.clipboard.writeText(currentCode); setCopied(true); }
            catch { setError('Select the code above and copy it.'); }
          }}>{copied ? '✓ Copied' : '📋 Copy board code'}</button>
        </form>
      </div>, document.body)}
  </>;
}

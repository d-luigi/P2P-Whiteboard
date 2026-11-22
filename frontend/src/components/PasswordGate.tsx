import { useState } from 'react';
import { useSync } from '../sync';
import { setPassword } from '../board';

/** Shown instead of connecting when a password-protected board is opened without its password. */
export default function PasswordGate() {
  const needsPassword = useSync((s) => s.needsPassword);
  const [pw, setPw] = useState('');
  const [skipped, setSkipped] = useState(false);
  if (!needsPassword || skipped) return null;

  return (
    <div className="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <form
        className="gate-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw) setPassword(pw);
        }}
      >
        <h2 id="gate-title">This board is password protected</h2>
        <p>Enter the password to join the people on it.</p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          aria-label="Board password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        <div className="gate-actions">
          <button type="submit" className="share-btn" disabled={!pw}>
            Join
          </button>
          <button type="button" className="chip-btn" onClick={() => setSkipped(true)}>
            Look at my saved copy offline
          </button>
        </div>
      </form>
    </div>
  );
}

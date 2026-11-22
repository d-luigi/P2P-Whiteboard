import { useState } from 'react';
import { openDialog, sendPasswordReset, setNewPassword, signIn, signUp, useAccount } from '../account';
import '../account.css';

const MIN_PASSWORD = 8;

/** Sign in, create an account, "forgot password", and "choose a new password" (from the email link). */
export default function AuthDialog() {
  const mode = useAccount((s) => s.dialog);
  const configured = useAccount((s) => s.configured);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!mode || !configured) return null;

  const switchTo = (next: 'signin' | 'signup' | 'forgot') => {
    setError(null);
    setNotice(null);
    openDialog(next);
  };
  const close = () => {
    if (busy) return;
    setError(null);
    setNotice(null);
    setPassword('');
    openDialog(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (mode !== 'reset' && !/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.');
    if ((mode === 'signup' || mode === 'reset') && password.length < MIN_PASSWORD) {
      return setError(`Use at least ${MIN_PASSWORD} characters for the password.`);
    }
    setBusy(true);
    try {
      if (mode === 'signin') await signIn(email, password);
      else if (mode === 'signup') {
        if (await signUp(email, password)) {
          setNotice('Almost there: we sent a confirmation link to your email. Open it on this device and you will be signed in.');
        }
      } else if (mode === 'forgot') {
        await sendPasswordReset(email);
        setNotice('If that address has an account, a reset link is on its way.');
      } else await setNewPassword(password);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create an account' : mode === 'forgot' ? 'Reset your password' : 'Choose a new password';

  return (
    <div className="gate" role="presentation" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <form className="gate-card auth" role="dialog" aria-modal="true" aria-labelledby="auth-title" onSubmit={submit}>
        <h2 id="auth-title">{title}</h2>

        {(mode === 'signin' || mode === 'signup') && (
          <div className="auth-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => switchTo('signin')}>
              Sign in
            </button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => switchTo('signup')}>
              Create account
            </button>
          </div>
        )}

        {mode === 'signup' && (
          <p className="hint">
            An account keeps your list of boards, and your name and colour, on every device. You can keep using boards as a
            guest without one.
          </p>
        )}
        {mode === 'forgot' && <p className="hint">We will email you a link to choose a new password.</p>}

        {mode !== 'reset' && (
          <label className="auth-field">
            Email
            <input type="email" autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        {mode !== 'forgot' && (
          <label className="auth-field">
            {mode === 'reset' ? 'New password' : 'Password'}
            <input
              type="password"
              autoFocus={mode === 'reset'}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}

        {(mode === 'signin' || mode === 'signup') && (
          <p className="hint">
            Boards you have opened on this device will be added to your account, including the owner keys of boards you own.
            Drawings are never stored in the account.
          </p>
        )}

        {error && (
          <p className="auth-msg error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="auth-msg" role="status">
            {notice}
          </p>
        )}

        <div className="gate-actions">
          <button type="submit" className="share-btn" disabled={busy}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send link' : 'Save password'}
          </button>
          {mode !== 'reset' && (
            <button type="button" className="chip-btn" disabled={busy} onClick={close}>
              Cancel
            </button>
          )}
        </div>
        {mode === 'signin' && (
          <button type="button" className="auth-link" onClick={() => switchTo('forgot')}>
            Forgot your password?
          </button>
        )}
        {mode === 'forgot' && (
          <button type="button" className="auth-link" onClick={() => switchTo('signin')}>
            Back to sign in
          </button>
        )}
      </form>
    </div>
  );
}

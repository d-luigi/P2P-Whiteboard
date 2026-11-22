import { readSession } from './cloudApi';

/**
 * Email links (confirm your address, reset your password) bring you back to the site with the
 * sign-in details in the address bar: `#access_token=…&refresh_token=…&type=signup`. The board
 * link lives in that same part of the address, so this must run BEFORE board.ts reads it:
 * main.tsx imports this file first. It saves the session, remembers what happened (so
 * account.ts can tell you), and clears the address bar; board.ts then reopens your last board.
 */
export const SESSION_KEY = 'p2pwb:session:v1';
export const AUTH_EVENT_KEY = 'p2pwb:authEvent';

(function captureAuthRedirect() {
  const hash = location.hash;
  if (!/^#(access_token|error)=/.test(hash)) return;
  const p = new URLSearchParams(hash.slice(1));
  try {
    const token = p.get('access_token');
    if (token) {
      const at = Number(p.get('expires_at'));
      const session = readSession({
        access_token: token,
        refresh_token: p.get('refresh_token'),
        expires_in: p.get('expires_in'),
        expires_at: Number.isFinite(at) && at > 0 ? at : undefined,
      });
      if (session) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        sessionStorage.setItem(AUTH_EVENT_KEY, p.get('type') === 'recovery' ? 'recovery' : 'signedin');
      }
    } else {
      sessionStorage.setItem(AUTH_EVENT_KEY, `error:${(p.get('error_description') ?? 'That link did not work.').slice(0, 200)}`);
    }
  } catch {
    /* storage blocked: nothing to remember */
  }
  history.replaceState(null, '', location.pathname + location.search);
})();

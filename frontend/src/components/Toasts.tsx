import { useEffect } from 'react';
import { useToasts, toast, dismissToast } from '../toast';
import { NOTICE_KEY } from '../docStore';

/** Bottom-centre messages. Also shows the one-off notice left by the last page load (compaction). */
export default function Toasts() {
  const toasts = useToasts((s) => s.toasts);

  useEffect(() => {
    try {
      const notice = sessionStorage.getItem(NOTICE_KEY);
      if (notice) {
        sessionStorage.removeItem(NOTICE_KEY);
        toast(notice);
      }
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.text}
          <button className="toast-x" aria-label="Dismiss message" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

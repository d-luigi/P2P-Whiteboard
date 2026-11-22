import { useRoomCode } from '../roomCodes';
import { toast } from '../toast';

export default function BoardCode() {
  const { code, error } = useRoomCode();
  return (
    <label className="board-code">
      <span>Board code</span>
      <input
        aria-label="Board code"
        title={error || 'Tap to copy this code, then paste it into Join board'}
        readOnly
        value={code}
        placeholder={error ? 'Unavailable' : 'Loading…'}
        size={11}
        onFocus={(event) => event.target.select()}
        onClick={async (event) => {
          if (!code) { if (error) toast(error, 'error'); return; }
          event.currentTarget.select();
          try {
            await navigator.clipboard.writeText(code);
            toast('Board code copied. Paste it into Join board.');
          } catch {
            toast('Board code selected. Copy it and paste it into Join board.');
          }
        }}
      />
    </label>
  );
}

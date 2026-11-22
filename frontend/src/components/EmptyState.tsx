import { useDoc } from '../docStore';
import { readOnly } from '../board';

/** A hint on a blank board; disappears as soon as there is something on it. */
export default function EmptyState() {
  const empty = useDoc((s) => Object.keys(s.shapes).length === 0);
  if (!empty) return null;
  return (
    <div className="empty-board" role="note">
      {readOnly ? (
        <p>Nothing on this board yet. You're viewing it read-only, so anything others draw will appear here.</p>
      ) : (
        <>
          <p className="big">A blank board</p>
          <p>Pick a tool above and start drawing, or press Share to invite others.</p>
          <p className="small">Press ? for keyboard shortcuts.</p>
        </>
      )}
    </div>
  );
}

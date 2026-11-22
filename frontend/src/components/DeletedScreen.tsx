import { newBoard } from '../board';

/** Shown instead of the whiteboard once an owner has deleted the board. */
export default function DeletedScreen() {
  return (
    <div className="fatal" role="alert">
      <h2>This board was deleted</h2>
      <p>
        Its owner deleted it. It is no longer saved on this device, and its link doesn't open
        anything any more.
      </p>
      <div className="fatal-actions">
        <button className="share-btn" autoFocus onClick={newBoard}>
          Start a new board
        </button>
      </div>
    </div>
  );
}

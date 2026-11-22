import { useState } from 'react';
import { usePresence, follow, setName, setColor, PALETTE } from '../presence';
import { useSync, connectionStatus, type ConnectionStatus } from '../sync';
import { useUI } from '../uiStore';
import ShareDialog from './ShareDialog';
import AccountPanel from './AccountPanel';
import { setPanelOpen, useAccount } from '../account';

const LABEL: Record<ConnectionStatus, string> = {
  online: 'Online',
  syncing: 'Syncing…',
  offline: 'Offline',
};

const initial = (name: string) => (Array.from(name.trim())[0] ?? '?').toUpperCase();

/** Bottom-right: connection status, who is here (with follow), and the share-link button. */
export default function Presence() {
  const me = usePresence((s) => s.me);
  const peers = usePresence((s) => s.peers);
  const status = useSync(connectionStatus);
  const peerCount = useSync((s) => s.peers);
  const followId = useUI((s) => s.followId);
  const [open, setOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const accountOpen = useAccount((s) => s.panelOpen);
  const signedIn = useAccount((s) => !!s.session);

  const followed = peers.find((p) => p.id === followId);

  const statusTitle =
    status === 'offline'
      ? 'Offline: not connected to the signalling server and no one else is connected. Your edits are saved in this browser and merge in when you reconnect (is the signalling server running and VITE_SIGNALING pointing at it?).'
      : status === 'syncing'
        ? 'Syncing the board with the people connected to you…'
        : peerCount > 0
          ? 'Online and in sync.'
          : 'Online. Share the link so others can join.';

  return (
    <div className="presence">
      {followed && (
        <div className="follow-chip" role="status">
          <span className="swatch" style={{ background: followed.color }} />
          Following {followed.name}
          <button className="chip-btn" onClick={() => follow(null)}>
            Stop
          </button>
        </div>
      )}

      {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
      {accountOpen && <AccountPanel onClose={() => setPanelOpen(false)} />}

      {open && (
        <div
          className="presence-panel"
          role="dialog"
          aria-label="Who's online"
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        >
          <div className="panel-title">Who's online</div>

          <div className="person me">
            <span className="swatch" style={{ background: me.color }} />
            <input
              className="name-input"
              type="text"
              maxLength={24}
              defaultValue={me.name}
              aria-label="Your name"
              onBlur={(e) => {
                setName(e.target.value);
                e.target.value = usePresence.getState().me.name;
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <span className="you">you</span>
          </div>
          <div className="palette" role="group" aria-label="Your colour">
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`palette-dot ${me.color === c ? 'active' : ''}`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
                aria-pressed={me.color === c}
                onClick={() => setColor(c)}
              />
            ))}
          </div>

          {peers.length === 0 ? (
            <p className="empty">No one else is here yet. Share the link to invite people.</p>
          ) : (
            peers.map((p) => (
              <div key={p.id} className="person">
                <span className="swatch" style={{ background: p.color }} />
                <span className="person-name">{p.name}</span>
                <button
                  className={`chip-btn ${followId === p.id ? 'on' : ''}`}
                  title={followId === p.id ? 'Stop following' : "Follow this person's view"}
                  aria-pressed={followId === p.id}
                  onClick={() => follow(followId === p.id ? null : p.id)}
                >
                  {followId === p.id ? 'Following' : 'Follow'}
                </button>
              </div>
            ))
          )}
        </div>
      )}

      <div className="presence-bar">
        <span className={`status ${status}`} title={statusTitle} role="status">
          <span className="status-dot" />
          {LABEL[status]}
        </span>

        <button
          className="avatars"
          title="Who's online"
          aria-label={`Who's online: you and ${peers.length} other${peers.length === 1 ? '' : 's'}`}
          aria-expanded={open}
          onClick={() => {
            setOpen((o) => !o);
            setShareOpen(false);
            setPanelOpen(false);
          }}
        >
          <span className="avatar" style={{ background: me.color }}>
            {initial(me.name)}
          </span>
          {peers.slice(0, 4).map((p) => (
            <span key={p.id} className="avatar" style={{ background: p.color }}>
              {initial(p.name)}
            </span>
          ))}
          {peers.length > 4 && <span className="avatar more">+{peers.length - 4}</span>}
        </button>

        <button
          className="chip-btn boards-btn"
          title={signedIn ? 'My boards and account' : 'My boards (using as a guest)'}
          aria-label="My boards and account"
          aria-expanded={accountOpen}
          onClick={() => {
            setPanelOpen(!accountOpen);
            setOpen(false);
            setShareOpen(false);
          }}
        >
          {signedIn ? '👤' : '📋'}
        </button>

        <button
          className="share-btn"
          title="Share this board"
          aria-expanded={shareOpen}
          onClick={() => {
            setShareOpen((o) => !o);
            setOpen(false);
            setPanelOpen(false);
          }}
        >
          🔗 Share
        </button>
      </div>
    </div>
  );
}

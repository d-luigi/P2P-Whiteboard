import { WebrtcProvider } from 'y-webrtc';
import { Awareness } from 'y-protocols/awareness';
import { create } from 'zustand';
import { ydoc } from './docStore';
import { boardId, getPassword, isMarkedDeleted, passwordProtected, passwordsSupported } from './board';
import { sha256Hex } from './sha256';

/**
 * LIVE SYNC: connects this board's Y.Doc to everyone else who has the same board link.
 *
 *  - Peers join a "room" named after the board ID and exchange Yjs updates directly over
 *    WebRTC. Nothing is stored on a server.
 *  - A small signalling server is only used to introduce peers to each other (start one with
 *    `npm run signal`). Different browsers on one machine or one network find each other
 *    through it; tabs of the same browser also sync via BroadcastChannel without it.
 *  - Between different networks you need (1) a signalling server that both can reach and
 *    (2) sometimes a TURN relay. See .env.example.
 *  - The room name is a SHA-256 of the secret board ID, so the signalling server (which sees
 *    room names) never learns the ID and can't join your board.
 *  - Optional password: y-webrtc encrypts the signalling messages with it, so people without
 *    it can't even connect. (It does not encrypt what is saved in this browser.)
 *  - `awareness` carries the ephemeral per-user state (cursor, name, colour, camera,
 *    laser): see presence.ts. It is never saved in the document.
 *
 * Remote updates arrive with the provider as their transaction origin, so the undo manager
 * (which tracks only local edits) never undoes a peer's work.
 */
const env = import.meta.env as Record<string, string | undefined>;

const defaultSignaling = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:4444`;
const signaling = (env.VITE_SIGNALING ?? defaultSignaling)
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

const iceServers: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
];
if (env.VITE_TURN_URL) {
  iceServers.push({
    urls: env.VITE_TURN_URL.split(',').map((u) => u.trim()).filter(Boolean),
    username: env.VITE_TURN_USER,
    credential: env.VITE_TURN_CREDENTIAL,
  });
}

/** Ephemeral per-user state (cursor, name, ...). Created here so it exists even if connecting fails. */
export const awareness = new Awareness(ydoc);

let initError: string | null = null;
let needsPassword = false;
let provider: WebrtcProvider | null = null;

const password = getPassword();
if (isMarkedDeleted()) {
  // Deleted by its owner: never connect to anyone for this board.
} else if (passwordProtected && !password) {
  needsPassword = true; // PasswordGate asks; we connect to no one until then
} else if (password && !passwordsSupported) {
  initError = 'Passwords need https:// or localhost, so this board is not connected. Open it from a secure address.';
} else {
  try {
    provider = new WebrtcProvider(`p2pwb:${sha256Hex(`p2pwb:room:v1:${boardId}`)}`, ydoc, {
      signaling,
      password: password ?? undefined,
      awareness,
      peerOpts: { config: { iceServers } },
    });
  } catch (err) {
    console.error('Could not start live sync', err);
    initError = 'Live sync could not start in this browser. You can still draw; changes are saved here.';
  }
}

export { provider };

interface SyncState {
  /** The browser itself reports a network connection. */
  browserOnline: boolean;
  /** Connected to at least one signalling server (needed to find new peers). */
  signalingUp: boolean;
  /** Other browsers / tabs currently connected to this board (WebRTC + same-browser tabs). */
  peers: number;
  /** How many of those are over WebRTC (other browsers / devices). */
  webrtcPeers: number;
  /** Caught up with every WebRTC peer. */
  synced: boolean;
  /** The board is password protected and we don't have the password yet. */
  needsPassword: boolean;
  /** Why live sync is not running, if it isn't. */
  syncError: string | null;
}

export const useSync = create<SyncState>(() => ({
  browserOnline: navigator.onLine,
  signalingUp: false,
  peers: 0,
  webrtcPeers: 0,
  synced: false,
  needsPassword,
  syncError: initError,
}));

export type ConnectionStatus = 'online' | 'syncing' | 'offline';

/**
 *  offline  no network, or neither a signalling server nor any peer is reachable
 *  syncing  connected to another device but still exchanging the board with it
 *  online   everything else (connected; possibly alone on the board)
 * Edits made while offline are kept in this browser and merged in when peers reconnect.
 */
export const connectionStatus = (s: SyncState): ConnectionStatus => {
  if (!s.browserOnline || s.needsPassword || s.syncError) return 'offline';
  if (!s.signalingUp && s.peers === 0) return 'offline';
  if (s.webrtcPeers > 0 && !s.synced) return 'syncing';
  return 'online';
};

provider?.on('peers', (e: { webrtcPeers: string[]; bcPeers: string[] }) => {
  useSync.setState({ peers: e.webrtcPeers.length + e.bcPeers.length, webrtcPeers: e.webrtcPeers.length });
});

// The signalling connection and sync state come and go: just poll them.
const poll = () => {
  const room = provider?.room as { synced?: boolean } | null;
  const next = {
    browserOnline: navigator.onLine,
    signalingUp: !!provider?.signalingConns.some((c) => c.connected),
    synced: !!room?.synced,
  };
  const cur = useSync.getState();
  if (
    cur.browserOnline !== next.browserOnline ||
    cur.signalingUp !== next.signalingUp ||
    cur.synced !== next.synced
  ) {
    useSync.setState(next);
  }
};
poll();
window.setInterval(poll, 500);
window.addEventListener('online', () => {
  // Back on the network: reconnect to the signalling server now rather than at the next retry.
  provider?.signalingConns.forEach((c) => {
    if (!c.connected && !c.connecting) c.connect();
  });
  poll();
});
window.addEventListener('offline', poll);

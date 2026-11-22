# P2P Whiteboard

A collaborative whiteboard that runs in the browser with **no server storing your drawings**, and no
account needed (an optional account keeps your list of boards on all your devices). Boards are shared by link; people connect directly to each other (WebRTC) and stay in
sync with [Yjs](https://yjs.dev), a CRDT, so edits merge cleanly, including edits made offline.

## What it does

- Drawing: pen, line, arrow, rectangle, ellipse, text, partial eraser; rectangle and free-form
  (lasso) selection, move / resize, layer order, duplicate
- Infinite canvas: pan, zoom, go to any coordinates, one-click return to (0, 0); your position is
  remembered per board
- Undo / redo that survives a reload
- Works offline: boards are saved in the browser (IndexedDB) and merge when you reconnect
- Live collaboration: cursors with names and colours, who's online, connection status, follow
  someone's view, laser pointer
- Sharing: edit link, view-only link, optional password
- My boards: every board you open is listed (rename, reopen); optional account (email + password) syncs
  the list, your name and colour, and your board ownership across devices. Guests (no account) work as before
- Backup: download / import a board file; automatic compaction of large boards
- Touch screens (pinch to zoom, two-finger pan), keyboard shortcuts (`?`), screen-reader support

## Repository layout

```
.
├── frontend/        The web app (React + Vite + Konva + Yjs). Deploy to Vercel / any static host.
├── signaling/       Tiny WebSocket server that lets browsers find each other. Deploy to Render / Fly / etc.
├── supabase/
│   └── schema.sql      Tables for the optional accounts (run once in Supabase)
├── docs/
│   ├── DEPLOYMENT.md   Step-by-step: Vercel (frontend) + Render (signalling) + optional TURN
│   └── ACCOUNTS.md     Optional accounts: what is stored, Supabase setup, behaviour
├── render.yaml      One-click Render blueprint for signaling/
└── package.json     Convenience scripts that call into the folders above
```

The two halves are independent packages with their own `package.json`; nothing is shared. The
**signalling server only introduces browsers to each other**. It never sees drawings, and the room
name it sees is a hash of the board's secret ID.

## Run it locally

Needs Node.js 18 or newer.

```bash
npm run setup      # once: installs frontend/ and signaling/
npm run signal     # terminal 1: signalling server on ws://localhost:4444
npm run dev        # terminal 2: the app on http://localhost:5173
```

Open the app, copy the link with **Share**, and open it in a second browser. Both should show a
green status dot and see each other's cursors.

| Command (from repo root) | What it does |
| --- | --- |
| `npm run setup` | Install dependencies in both folders |
| `npm run dev` | Start the web app (Vite dev server, also reachable from other devices on your network) |
| `npm run signal` | Start the signalling server |
| `npm run build` | Type-check and build the web app into `frontend/dist` |
| `npm run test:signal` | Run the signalling server's tests |
| `npm run test:frontend` | Run the account/list tests (needs Node 22.18+) |

You can also `cd frontend` or `cd signaling` and use their own `npm run …` scripts directly.

## Configuration

Frontend (`frontend/.env.local`, or your host's environment variables; see
[`frontend/.env.example`](frontend/.env.example)):

| Variable | Purpose |
| --- | --- |
| `VITE_SIGNALING` | Signalling server URL(s), e.g. `wss://p2pwb-signaling.onrender.com`. Defaults to port 4444 on the page's own host. |
| `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_CREDENTIAL` | Optional TURN relay for networks where a direct connection is impossible |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Optional: turns on accounts. See [docs/ACCOUNTS.md](docs/ACCOUNTS.md) |

Signalling server: `PORT` (default 4444) and `ALLOWED_ORIGINS` (which websites may connect).

## Security model (read before sharing links)

- **The link is the key.** A new board's ID is 128 random bits, so it can't be guessed. Anyone who has
  the link can edit.
- **View-only links are a courtesy, not a lock.** There is no server to enforce permissions: every
  peer holds the whole document. They hide the editing tools and block edits in that tab, but a
  determined person could still edit their own copy.
- **Passwords are real access control for live sharing**: without it a browser can't connect to the
  board's peers. They need HTTPS or localhost, and don't encrypt the copy saved in a browser.
- Data from other peers is validated before it is drawn.
- **Accounts trade some of this away, only for people who sign in.** The account stores the IDs of your
  boards and the owner keys of boards you own, so whoever runs the Supabase project could open them.
  Guests send nothing to any server. Details in [docs/ACCOUNTS.md](docs/ACCOUNTS.md).

## Deploying

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Known limitations

- Phones: the toolbar wraps onto several rows on small screens.
- Two devices on strict networks (e.g. a phone on mobile data) need a TURN relay to connect.
- Compacting a board resets its undo history.

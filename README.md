# P2P Whiteboard

An installable, peer-to-peer collaborative whiteboard for drawing, planning, and sharing ideas in real time. Open a board in the browser, share its short room code, and collaborate without sending drawings through a central database.

![P2P Whiteboard](frontend/public/icons/icon-512.png)

## Features

- Draw with pen, lines, arrows, rectangles, ellipses, and text.
- Select, move, resize, duplicate, reorder, and erase items.
- Add images, animated GIFs, editable sticky notes, and board templates.
- Pan and zoom an infinite canvas, with saved camera position and undo history.
- Collaborate through WebRTC with live cursors, presence, follow mode, and a laser pointer.
- Join boards with six-character room codes. Password-protected boards prompt for their password.
- Share edit links, view-only links, or password-protected boards.
- Keep boards offline in IndexedDB and merge changes when the connection returns.
- Optionally sync board lists, ownership, display names, and colours with Supabase accounts.
- Install the app on desktop or mobile as a PWA.

> [!NOTE]
> Drawings remain in browsers and are synchronized peer to peer. The short-code directory temporarily stores a board ID and its access flags so a six-character code can resolve to the correct board.

## Project structure

```text
.
├── frontend/                 React, Vite, Konva, and Yjs web app
├── signaling/                WebSocket signaling and short-code directory
├── supabase/schema.sql       Optional account tables
├── docs/                     Deployment, accounts, offline, and room-code guides
├── render.yaml               Render deployment blueprint for signaling
└── package.json              Root convenience scripts
```

## Run locally

Requires Node.js 18 or newer.

```bash
npm run setup
npm run signal   # terminal 1, ws://localhost:4444
npm run dev      # terminal 2, http://localhost:5173
```

Open the app in two browsers. Use **Join board** and enter the six-character code shown in the host toolbar.

| Command | Purpose |
| --- | --- |
| `npm run setup` | Install frontend and signaling dependencies |
| `npm run dev` | Start the Vite development server |
| `npm run signal` | Start the WebSocket signaling server |
| `npm run build` | Type-check and build the frontend |
| `npm run test:signal` | Run signaling and room-code tests |
| `npm run test:frontend` | Run frontend account, registry, and service-worker tests |

## Configuration

Set frontend variables in `frontend/.env.local` or in your hosting provider. See [`frontend/.env.example`](frontend/.env.example).

| Variable | Purpose |
| --- | --- |
| `VITE_SIGNALING` | One or more WebSocket signaling server URLs |
| `VITE_TURN_URL` | Optional TURN server URLs for restrictive networks |
| `VITE_TURN_USER` | TURN username |
| `VITE_TURN_CREDENTIAL` | TURN credential |
| `VITE_SUPABASE_URL` | Optional Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Optional Supabase publishable key |

Configure the signaling server with `PORT` and `ALLOWED_ORIGINS`. Deploy the updated frontend and signaling server together when using short room codes. See [`docs/ROOM_CODES.md`](docs/ROOM_CODES.md).

## Deployment

Follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for Vercel, Render, TURN, and account setup. The offline and installable app behavior is documented in [`docs/OFFLINE.md`](docs/OFFLINE.md). Optional account storage is described in [`docs/ACCOUNTS.md`](docs/ACCOUNTS.md).

## Security model

- A board link or room code grants access to that board. Treat it as a secret.
- Password protection gates live peer connections. It does not encrypt the browser's local copy.
- View-only mode hides editing controls and prevents accidental edits in that tab. It is not server-enforced authorization.
- Incoming peer data is validated before rendering.
- Short codes expire after 24 hours of inactivity and are kept in signaling-server memory.

## Limitations

- Networks that block direct WebRTC connections may require TURN.
- Restarting the signaling server clears its in-memory room-code directory.
- Compacting a board clears its undo history.

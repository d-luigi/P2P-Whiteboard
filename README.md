# P2P Whiteboard

<div align="center">
  <img src="docs/brand/p2p-lockup.svg" alt="P2P Whiteboard" width="640" />

  <h2>Draw together. Think together.</h2>
  <p><strong>A lightweight peer-to-peer whiteboard for planning, sketching, and sharing ideas in real time.</strong></p>
  <p>
    <a href="https://github.com/d-luigi/P2P-Whiteboard"><img src="https://img.shields.io/badge/license-MIT-2563EB.svg" alt="MIT License"></a>
    <a href="https://github.com/d-luigi/P2P-Whiteboard"><img src="https://img.shields.io/badge/transport-WebRTC-111827.svg" alt="WebRTC"></a>
    <a href="https://github.com/d-luigi/P2P-Whiteboard"><img src="https://img.shields.io/badge/mobile-PWA-2563EB.svg" alt="Progressive Web App"></a>
  </p>
</div>

## Demo video

<video controls preload="metadata" width="100%" poster="https://github.com/d-luigi/P2P-Whiteboard/raw/refs/heads/parikshit-work/docs/demo/brag.jpg">
  <source src="https://github.com/d-luigi/P2P-Whiteboard/raw/refs/heads/parikshit-work/docs/demo/brag.mp4" type="video/mp4">
  <a href="https://github.com/d-luigi/P2P-Whiteboard/raw/refs/heads/parikshit-work/docs/demo/brag.mp4">Download or play brag.mp4</a>
</video>

The 21-second demo plays inline above. The board content and room code are fictional examples. [Music and sound credits](docs/demo/music-credit.txt).

## What it does

P2P Whiteboard opens an infinite canvas directly in the browser. Create a board, share its six-character room code, and collaborate live without routing drawings through a central database.

- Draw with pens, shapes, arrows, and editable text.
- Select, move, resize, duplicate, reorder, and erase items.
- Add images, GIFs, sticky notes, and board templates from one insert menu.
- Collaborate with live cursors, presence, follow mode, and a laser pointer.
- Use password-protected boards, view-only links, and short join codes.
- Keep working offline with local board storage and undo history.
- Install it on desktop or mobile as a PWA.

> [!NOTE]
> Drawings stay in browsers and synchronize peer to peer. The signaling server only helps peers discover each other and resolve temporary room codes.

## Try it locally

Requires Node.js 18 or newer.

```bash
npm run setup
npm run signal   # terminal 1 — ws://localhost:4444
npm run dev      # terminal 2 — http://localhost:5173
```

Open the app in two browsers. Choose **Join board** and enter the six-character code shown in the host toolbar.

| Command | Purpose |
| --- | --- |
| `npm run setup` | Install frontend and signaling dependencies |
| `npm run dev` | Start the Vite development server |
| `npm run signal` | Start the WebSocket signaling server |
| `npm run build` | Type-check and build the frontend |
| `npm run test:signal` | Run signaling and room-code tests |
| `npm run test:frontend` | Run frontend tests |

## Project layout

```text
frontend/       React, Vite, Konva, and Yjs whiteboard app
signaling/      WebSocket signaling and short-code directory
supabase/       Optional account schema
docs/           Deployment, offline, account, and room-code guides
docs/brand/     Logo assets and usage guide
```

## Tech stack

- **Frontend:** React, TypeScript, Vite, and Tailwind CSS
- **Canvas:** Konva with `react-konva`
- **Collaboration:** WebRTC, Yjs, and `y-webrtc`
- **Signaling:** Node.js, WebSocket, and Express
- **Persistence:** IndexedDB for offline boards
- **Optional accounts:** Supabase
- **Deployment:** Vercel for the frontend and Render for signaling

## Configuration

Copy `frontend/.env.example` to `frontend/.env.local` when you need custom infrastructure.

| Variable | Purpose |
| --- | --- |
| `VITE_SIGNALING` | WebSocket signaling server URL(s) |
| `VITE_TURN_URL` | Optional TURN server for restrictive networks |
| `VITE_TURN_USER` | TURN username |
| `VITE_TURN_CREDENTIAL` | TURN credential |
| `VITE_SUPABASE_URL` | Optional Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Optional Supabase publishable key |

Read [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), [`docs/OFFLINE.md`](docs/OFFLINE.md), and [`docs/ROOM_CODES.md`](docs/ROOM_CODES.md) for deployment and infrastructure details.

## Security notes

- Treat board links and room codes as secrets.
- Password protection gates live peer connections but does not encrypt a browser's local copy.
- View-only mode is a client-side editing guard, not server authorization.
- Short codes expire after 24 hours of inactivity and live in signaling-server memory.

## Brand

The horizontal wordmark and connected-tiles mark are documented in [`docs/brand/README.md`](docs/brand/README.md).

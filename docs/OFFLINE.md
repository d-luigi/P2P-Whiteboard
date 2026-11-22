# Installing and working offline (PWA)

The whiteboard is an installable web app (PWA). Installed or not, it opens with no network once it
has been loaded once online.

## Installing

| Device | How |
| --- | --- |
| Windows / Mac / Linux (Chrome, Edge) | ⋯ menu → **Install app…**, or the install icon in the address bar |
| Android (Chrome) | ⋯ menu → **Install app…**, or browser menu → *Install app* |
| iPhone / iPad | Safari only: **Share → Add to Home Screen** (iOS has no install prompt; the menu item explains this) |

Needs HTTPS (Vercel provides it). Locally, `npm run dev` does **not** register the offline worker;
test with `npm run build` then `npx vite preview`.

## What works offline

- The app opens (page, scripts, icons are saved by `frontend/public/sw.js`).
- Drawing, editing, undo/redo, backups: boards are saved in the browser (IndexedDB), as before.
- The *My boards* list (guest or signed in). Account syncing resumes when you're back online.

## When you come back online

The browser reconnects to the signalling server immediately, finds the other people on the board,
and Yjs merges everyone's changes (nobody's edits are lost or overwritten).

**There is still no server holding the board.** Changes travel only between devices that have the
board open at the same moment. If you edit offline on your phone and your laptop is off, the laptop
sees the changes the next time both have the board open and online together. Open the board on the
device you want to be up to date, and wait for the green *Online* pill.

## Updates

Online, the page is always fetched fresh, so a new deployment appears on the next load (close and
reopen the installed app, or reload). Offline, the last version you loaded is used.

## Platform notes

- **iOS Safari tabs** may clear saved data after about a week without visits. A board added to the
  Home Screen isn't subject to that rule. Either way, *⋯ → Download backup* is the safety net.
- The app asks the browser to keep its storage (`navigator.storage.persist()`); browsers may decline silently.
- Email links (confirm, reset password) open in the browser, not the installed app. On iPhone/iPad the Home Screen app keeps its own storage, so expect to sign in once inside it.

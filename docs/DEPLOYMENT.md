# Deploying

The app has two parts and they need different kinds of hosting:

| Part | Folder | Needs | Good fit |
| --- | --- | --- | --- |
| Web app | `frontend/` | Static files over HTTPS | **Vercel** (also Netlify, Cloudflare Pages, GitHub Pages) |
| Signalling server | `signaling/` | A Node process that stays running and holds WebSocket connections | **Render** (also Fly.io, Railway, Koyeb, any VPS) |

Why not both on Vercel? The signalling server keeps its list of who is in which room in memory, so
every browser in a room must reach the *same* running process. Vercel Functions can serve
WebSockets (beta), but connections are cut at the function's maximum duration and different
connections can land on different instances, so two people on the same board might never meet.
It is possible with an external Redis, but that is extra moving parts for no benefit here.

Order: **1. signalling server, 2. frontend, 3. lock the signalling server to your site.**

## 1. Signalling server on Render

Push the repo to GitHub first.

**Option A: blueprint (fastest).** Render dashboard → *New* → *Blueprint* → pick the repo. It reads
`render.yaml` and creates a free web service called `p2pwb-signaling` (region: Singapore).

**Option B: by hand.** *New* → *Web Service* → pick the repo, then:

| Setting | Value |
| --- | --- |
| Root Directory | `signaling` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/` |
| Instance type | Free |

When it's live, note its URL, e.g. `https://p2pwb-signaling.onrender.com`. The address the app needs
is the same host with `wss://` instead of `https://`: **`wss://p2pwb-signaling.onrender.com`**.
Opening the https URL in a browser should show `p2pwb signalling server: ok`.

> **Free-tier behaviour.** A free Render service spins down after 15 minutes with no inbound
> traffic and takes about a minute to wake up on the next connection. While anyone has the app open
> it keeps itself awake (the browsers send periodic messages). Before a demo, open the service's URL
> once to wake it. Free instance hours are limited per month, so don't keep it pinged 24/7 unless
> you checked your allowance. Boards are not stored on it, so nothing is lost when it sleeps.

## 2. Frontend on Vercel

1. Vercel → *Add New…* → *Project* → import the GitHub repo.
2. **Root Directory: `frontend`.** (This is the one setting people miss.)
3. Framework preset: Vite (auto-detected). Build command `npm run build`, output directory `dist`.
4. *Environment Variables*, added **before** the first deploy (Vite bakes them in at build time):

   | Name | Value |
   | --- | --- |
   | `VITE_SIGNALING` | `wss://p2pwb-signaling.onrender.com` (your Render host) |
   | `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_CREDENTIAL` | optional, see step 4 below |

5. Deploy. Changing an environment variable later needs a **redeploy** to take effect.

`npm run build` runs the TypeScript checker first, so a type error fails the deployment. Run
`npm run build` locally before pushing.

HTTPS comes for free from Vercel, which also makes the board **password** feature available (it needs
HTTPS or localhost) and lets the clipboard "Copy link" button work.

## 3. Lock the signalling server to your site

On Render → the service → *Environment* → set

```
ALLOWED_ORIGINS=https://your-project.vercel.app
```

Several allowed sites can be listed, comma-separated, and `*` matches within one part, e.g.
`https://your-project.vercel.app,https://*.vercel.app` (the second also allows Vercel preview
deployments, which have their own addresses). Anyone else's website is then refused. Leaving it empty
accepts any origin.

## 4. Testing on a phone, and when you need TURN

- **Phone and laptop on the same Wi-Fi:** works with no extras.
- **Phone on mobile data, laptop elsewhere:** often fails, because many mobile networks block direct
  connections. You then need a **TURN relay**, which forwards the traffic between the two devices
  (still encrypted by WebRTC; the relay can't read it).

For a demo, a free TURN account is enough: [Metered](https://www.metered.ca/stun-turn) has a free tier
(small monthly allowance; a whiteboard uses very little data) that gives you a username and
credential. Put them in Vercel's environment variables:

```
VITE_TURN_URL=turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443?transport=tcp
VITE_TURN_USER=...
VITE_TURN_CREDENTIAL=...
```

(Use the exact server addresses your provider's dashboard shows.) These values end up in the public
JavaScript bundle, so use a throwaway/limited account. Cloudflare's TURN service is another option
but issues short-lived credentials from its API, which needs a small server to hand them out.

## Checklist when something doesn't connect

1. Status pill is red: the app can't reach the signalling server. Check `VITE_SIGNALING` (must start
   with `wss://` on an https site), that the Render service is awake, and `ALLOWED_ORIGINS`.
2. Green, but you don't see the other person: both must open the **same link**, including the part
   after `#`. If the board is password protected, both need the password.
3. Works on Wi-Fi but not on mobile data: add TURN (step 4).
4. Browser console: look for `WebSocket connection to 'wss://…' failed`.

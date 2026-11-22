# Accounts

Accounts are **optional**. Without them everyone is a *guest*, and the app works exactly as before.

| | Guest (default) | Signed in |
| --- | --- | --- |
| Draw, share links, collaborate live | yes | yes |
| "My boards" list | on this device only | on every device |
| Owner of a board | on this device only | follows your account (owner keys sync) |
| Display name and colour | on this device | follow your account |
| Anything sent to a server | **nothing** | your board list + name/colour, to your Supabase project |

**What is stored in the account:** for each board, its ID, a name you gave it, whether you own it
(and the owner key), whether you opened it view-only or with a password, and timestamps. Plus your
display name and colour. **Drawings are never stored in the account**: boards still live in browsers
and sync peer to peer.

**Being anonymous.** There is no "anonymous account" on a server. A guest has no account at all, so
there is nothing to track and nothing to clean up. Signing in later keeps everything: the boards you
opened as a guest are merged into your account.

## What it costs you in privacy

Before accounts, the board link was a secret that no server ever saw. With an account, **your
Supabase project holds the IDs of your boards and the owner keys of boards you own.** Anyone who can
read that database (you, as the project owner, and Supabase) could open those boards, and owners can
delete them for everyone. Row level security stops *other users* from reading your rows; it does not
stop the person running the project. Guests are unaffected. Password-protected boards stay protected
(the password is never stored in the account).

## Setup (about 10 minutes, free tier is enough)

1. **Create a project** at [supabase.com](https://supabase.com) → *New project*.
2. **Create the tables:** *SQL Editor* → *New query* → paste [`supabase/schema.sql`](../supabase/schema.sql) → *Run*.
   (Safe to run again.)
3. **Authentication → Providers → Email:** keep it enabled. *Confirm email* on is recommended: new
   accounts must click a link first.
4. **Authentication → URL Configuration:**
   - *Site URL*: your site, e.g. `https://your-project.vercel.app`
   - *Redirect URLs*: add the same address, plus `http://localhost:5173` for local work and
     `https://*.vercel.app` if you want preview deployments to work. Confirmation and reset links
     only work for addresses listed here.
5. **Project Settings → API:** copy the *Project URL* and the *anon / publishable* key.
6. **Give them to the app.** In Vercel → *Settings → Environment Variables* add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then **redeploy** (Vite bakes them in at build
   time). Locally, put them in `frontend/.env.local`.

Both values are public by design. The anon key can do nothing without a signed-in user, because
every table has row level security (a user can only touch rows whose `user_id` is theirs).

Leave *Anonymous sign-ins* **off**: the app doesn't use them.

### Good to know

- **Email limits.** Supabase's built-in mailer sends only a few emails per hour and is meant for
  testing. Before real users, add your own SMTP provider (*Authentication → SMTP Settings*). With
  *Confirm email* off, sign-up needs no email at all (handy for a demo, less safe).
- **Free projects pause** after about a week without activity. Resume from the dashboard; no data is lost.
- **Deleting an account** is done in the Supabase dashboard (*Authentication → Users*); the
  user's rows are deleted with it. The app has no self-service delete, because that needs a server-side function.
- The signalling server on Render is **unchanged**. It doesn't know about accounts.

## How it behaves

- Opening a board adds it to *My boards* (📋 next to Share, or ⋯ → *My boards & account…*).
  Rename (✎) is for you only. ✕ removes it from the list, **not** the board.
- Signing in merges this device's list with the account's list. For a board changed on both, the
  most recent change wins, except that you never lose ownership or edit access.
- A board's owner key is restored when you open the board on a new device, so you are its owner there too.
- Syncing happens a couple of seconds after a change, when you return to the tab, and when you come back online.
- **Sign out** saves the list first (and refuses if it can't), then removes the list and owner keys
  from this device and reloads. The boards stay saved in the browser.

## Tests

`npm run test:frontend` (Node 22.18+, because the tests are TypeScript run directly). They cover the
list rules (`registryCore`) and the Supabase client against a fake server (`cloudApi`).

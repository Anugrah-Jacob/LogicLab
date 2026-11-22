# Sharing, live editing, chat, voice and history

## What people see

- **Share** button in the header (next to your avatar). It opens a box like Canva's: *People with access*, email
  invitations, and **Collaboration link** with three choices:
  - **Only you can access** (default; nobody can open it)
  - **Anyone with the link can view**: they see the circuit, run it, press switches and push buttons on their own screen. They cannot change it.
  - **Anyone with the link can edit**: they change the circuit together with you, live.
  Link access is open by default; adding a password makes sign-in and the password required. Email invitations are private to the invited account email: invitees sign in or create an account with that same email. The Share panel lists invited emails and can revoke them; **Email** opens the local mail app with the invitation link. **Copy link** copies a collaboration link. *More → Reset link* makes a new link (the old one stops working and people are disconnected); *Stop sharing* removes links and invitations.
- While a session is live a small bar floats at the top of the canvas: who is here (avatars, a green ring while someone talks), 🎙 microphone, 💬 chat. People's cursors are shown with their name.
- **Version history** (also in the Share box): versions are saved automatically (at most every 5-10 minutes while there are changes) and you can save a named one. Restoring keeps the current circuit in history first and can be undone with Ctrl+Z. Last 50 versions are kept.
- **Push button** (palette → Inputs & Outputs): a separate part. Output is 1 only while it is held down; it is never stuck on. The normal **Switch** and the **power button** work as before.

## Where things are stored

| What | Where |
| --- | --- |
| Accounts, login, project list (name, counts, dates), share links, version list | Cloudflare **D1** |
| The project data itself (the circuit JSON) and the body of every version | **MongoDB Atlas** when configured (see below), otherwise D1 |
| Edits, switches, cursors, chat, voice while people are connected | straight between browsers (**WebRTC**), not through any server |
| WebRTC handshake (a few short messages per connection) | the Cloudflare Pages Functions + D1, then no more |

Nothing is broken if MongoDB is not set up: everything works from D1 exactly as before.

## How live editing works (and its limits)

- Every part, wire, drawing, group and layer is its own item with a timestamp. When two people change the *same* item the later change wins; changes to different items never conflict, so two people can work in different corners at once and nothing is lost. Everyone ends with the same circuit whatever the order messages arrive.
- Each person gets their own range of part ids (up to 12 people per project), so two people never create the same id.
- **Each browser runs its own simulation.** Switch and button changes by editors are shared; the clock phase and waveform history can differ slightly between people. Power, pause and speed are personal.
- **Undo** covers your own changes. When someone else edits, your undo list is cleared, so you can never undo *their* work by accident.
- **Permissions** are enforced twice: the server refuses saves from view-only people, and every browser ignores edits sent by anyone whose role (given by the server) is *view*.
- The person who joined *later* starts from the latest saved copy and then receives the live state from a connected editor.
- Part names (A, B, C...) can repeat when two people add parts at the same moment; rename if it matters.
- **Voice and cross-firewall connections.** Browsers connect directly using free public STUN servers. Most home and office networks work. Some strict networks (symmetric NAT, some mobile carriers) cannot connect directly; the person then shows a red dot ("Can't connect"). Fix: add a TURN relay (below). Voice needs https and a microphone permission.

## Turning on MongoDB (optional)

1. Create a free cluster at https://www.mongodb.com/cloud/atlas, a database user, and in **Network Access** allow `0.0.0.0/0` (Cloudflare Workers have no fixed address).
2. Deploy the storage Worker (it is separate so the main site stays small):
   ```bash
   cd mongo-worker
   npm install
   npx wrangler secret put MONGODB_URI   # the Atlas connection string
   npx wrangler secret put API_KEY       # any long random string
   npx wrangler deploy                   # prints https://logiclab-mongo.<you>.workers.dev
   ```
3. On the LogicLab Pages project add the variable `MONGO_API_URL` (that address) and the secret `MONGO_API_KEY` (same string as `API_KEY`), or bind the Worker as a service binding named `MONGO`. Redeploy.
4. Admin → **System** shows *MongoDB (project storage)*. New saves go to MongoDB; D1 keeps a small marker. Projects saved earlier stay readable from D1 and move to MongoDB the next time they are saved. If MongoDB is unreachable while saving, the project is kept in D1 so nothing is lost.

The MongoDB driver runs in a Worker only on compatibility date 2025-03-20 or later with `nodejs_compat`; the storage Worker has its own `wrangler.toml` for that, so the main site's settings are unchanged.

## TURN relay (optional)

Set either `ICE_SERVERS` (a JSON list, for example from your TURN provider) or, with Cloudflare Realtime TURN, `TURN_KEY_ID` and the secret `TURN_API_TOKEN`. Without them, public STUN is used.

## Updating an existing site

```bash
npx wrangler d1 migrations apply logiclab --remote   # applies any pending collaboration migrations
SITE_URL=https://your-domain.com npm run build
npx wrangler pages deploy public --project-name logiclab
```
Until the migration is applied, Share shows no link and saving works as before. Admin → System shows "Live collaboration tables".

## Safety notes

- Share keys are random 128-bit values stored encrypted (with `JWT_SECRET`); the link carries the key after `#`, which browsers do not send to servers or in referrers.
- Join, signalling and saving are rate limited and size limited; a room holds 12 people.
- Chat is not stored anywhere. Names are limited to 24 characters and everything shown is escaped.
- Changing `JWT_SECRET` invalidates share links' stored keys: use *Reset link* afterwards.

## Tests

`npm run test:collab` runs the merge engine (including random three-person edit streams), the share/join/history/MongoDB API against a real SQLite database, and three real browsers editing one circuit over WebRTC (join, view-only, push button, chat, voice with a fake microphone, history restore). `node tests/pushbutton.test.mjs` covers the push button.

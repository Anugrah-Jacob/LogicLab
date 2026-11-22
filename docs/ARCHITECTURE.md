# Architecture

LogicLab is a static web app (no build step for the app itself) plus one serverless function.

```
browser                                         Cloudflare Pages
 index.html + js/app.js + js/examples.js  <---> functions/api/[[path]].js  <---> D1 (SQLite)
 localStorage (projects, offline)                 auth, project sync, AI proxy        |
 service worker (offline shell)                                                       +--> AI provider API (Groq by default)
```

## Files

- `public/js/app.js` is one classic script wrapped in a function. Its header lists the sections.
- `public/js/examples.js` defines `window.LOGICLAB_EXAMPLES` and `window.LogicLabNet` (the netlist builder).
- `scripts/build.mjs` reads the example library in Node to generate the static learn pages, so the library must stay
  free of browser-only code.

## Data model

```
node  { id, type, x, y, name, nin, per, trig, v, o[], q, r[], pc, cnt, key? }
wire  { a, ap, b, bp }       // output pin ap of node a -> input pin bp of node b
group { id, name, ids[], nids[] }   // node ids and drawing ids
note  { id, t, l, c, w, ... }       // a drawing: pen, line, arrow, rect, ell, text; l = layer id
```

`DEF` lists the part types with their pin names. IN/CLK are sources, LED/METER are sinks, AND/OR/NAND/NOR/XOR/XNOR/NOT/BUF
are gates, D/T/JK are flip-flops, SIPO/PISO are registers. `o[]` holds the output pin values.

## Simulation (`step`, `comb`, `settle`, `rc`, `tick`)

One tick does this:

1. Switches and clocks update.
2. Flip-flops and registers sample their inputs. They run in up to 8 *delta cycles*: when one flip-flop's output
   clocks another (a ripple counter), the next cycle lets that edge happen in the same tick, so waveforms line up.
3. Gates are evaluated (`comb`). In ideal mode the gates are updated one after another, which lets cross-coupled
   latches settle into a valid state (real gates never switch in perfect lockstep). In real-voltage mode every gate
   reads the same snapshot and `rc` slews each output toward its target voltage, so delays add up along a path.
4. `tick` compares the outputs with the previous tick. If gates keep changing while all sources and flip-flops are
   still, it sets `osc`, which shows the oscillation badge (race-around, ring oscillators). `settle` does the same
   check after every edit for loops that never converge.

## Main power and reset

`power` (default true) is checked by `tick`. When it is false `powerOffTick` zeroes every output and all memory each tick and still
records the waveform, so the graph shows a flat line. Turning power on calls `restartCircuit`: state cleared, clocks at phase 0,
the combinational start state found again, and in real-voltage mode every output rises from 0 V through the RC model. Reset does the
same and also clears the waveform history and the time axis.

## Examples

An example is data (`build(b)` describes parts and wires). `load(id)` calls `toolBuild`, the same function the AI agent
uses, then `aiLayout` places the parts: columns by logic depth, feedback wires ignored.

## Project file and storage

The Share menu's Download option writes `*.logiclab.json` (`app`, `ver`, `name`, settings, `nodes`, `wires`, `groups`, `notes`, `layers`, plus
simulation state), and can export PNG or PDF images. Files with `app: "GateForge"` (the earlier name) still open. Projects live in `localStorage`
under keys that start with `gf:` (the prefix is kept so existing data survives the rename):
`gf:<user or guest>:idx` (project list), `:p:<id>` (project), `:t:<id>` (thumbnail), `:del` (pending deletions).

## Sync

Signed-in users sync with `syncAll`: push projects marked `dirty` (or newer than the server copy), pull projects that
are newer on the server, apply queued deletions. The most recent edit wins. Triggered 2.5 s after a save, on reconnect and every minute.

## API

`functions/api/[[path]].js` only routes requests. The logic is in `server/`:

| File | Purpose |
| --- | --- |
| `util.js` | JSON helpers, password hashing, AES-GCM encryption of stored secrets |
| `auth.js` | Sign-up, login, sessions (signed cookie), "who is calling" |
| `projects.js` | Project sync (last write wins) |
| `settings.js` | Platform settings in the `settings` table, provider presets, the encrypted AI key |
| `ai.js` | System prompt, tools, and the provider layer (Anthropic format and OpenAI-compatible format) |
| `admin.js` | Everything under `/api/admin/*` |

Routes: `POST /api/auth/signup | login | logout`, `GET /api/me`, `GET /api/projects`, `GET | PUT | DELETE /api/projects/:id`,
`POST /api/ai`, and `/api/admin/*` (stats, activity, health, users, projects, settings, claim).
The database schema lives in `migrations/` (one numbered file per change; apply with `wrangler d1 migrations apply`).

## AI providers

Groq is the default provider for a fresh installation. Its API key is configured in the admin panel; saved provider settings take precedence over this default.
The browser always speaks the Anthropic message format (text, tool_use and tool_result blocks). For Anthropic the server forwards it
unchanged. For every other provider `toOpenAI` converts messages and tools to the OpenAI chat format and `fromOpenAI` converts the
answer back, so the browser code does not change when the administrator switches provider.

## AI agent

The browser sends the chat and a text summary of the canvas to `/api/ai`. The function adds the system prompt and tool list
and calls the model. When the model asks for a tool (`build_circuit`, `set_input`, `get_state`, `control_simulation`,
`load_template`, `clear_circuit`), the browser runs it (`execTool`), sends the result back, and repeats (at most 8 rounds).

## Versioning and caching

`npm run build` stamps `?v=<hash>` on scripts and styles and writes the same hash into `sw.js`, so every deployment gets
fresh files. Scripts and styles are cached for a year (they are versioned); `index.html` and `sw.js` are never cached.

## Live collaboration (added)

- `public/js/merge.js` is the merge engine (items with timestamps, no DOM). `public/js/collab.js` is the share box, presence bar, chat, voice, history and the WebRTC mesh. app.js exposes `window.LogicLabHost` and calls `window.LogicLabHook`; view-only mode is the `RO` flag in app.js (UI guards plus a revert in `commit()`).
- `server/collab.js` (share links, rooms, signalling, saving), `server/history.js` (versions), `server/store.js` (optional MongoDB bridge). `mongo-worker/` is the separate Worker that talks to Atlas. See COLLABORATION.md.

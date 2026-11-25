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
node  { id, type, x, y, name, nin, per, trig, v, o[], q, r[], pc, cnt, scale, rot, key? }
wire  { a, ap, b, bp, bends?, mode? }  // output pin ap of node a -> input pin bp of node b
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
simulation state), and can export PNG or PDF images. Custom image export can include the whole project or the current selection and can omit
parts, wires, or drawings. Gate transforms and colors, plus wire routes and colors, are stored in the project and synchronized as item edits.
New wires use automatic orthogonal routing by default; the manual Wire tool remains available for placing bends. Auto-arrange only clears
custom routes on wires whose two endpoints are in the current selection, so it never moves parts or touches other circuits.
Files with `app: "GateForge"` (the earlier name) still open. Projects live in `localStorage`
under keys that start with `gf:` (the prefix is kept so existing data survives the rename):
`gf:<user or guest>:idx` (project list), `:p:<id>` (project), `:t:<id>` (thumbnail), `:del` (pending deletions).

## Sync

Signed-in users sync with `syncAll`: push projects marked `dirty` (or newer than the server copy), pull projects that
are newer on the server, apply queued deletions. The most recent edit wins. Triggered two minutes after a changed local save, on reconnect and every two minutes. Unchanged projects are not uploaded.

## API

`functions/api/[[path]].js` only routes requests. The logic is in `server/`:

| File | Purpose |
| --- | --- |
| `util.js` | JSON helpers, password hashing, AES-GCM encryption of stored secrets |
| `auth.js` | Sign-up, login, sessions (signed cookie), "who is calling" |
| `projects.js` | Project sync (last write wins) |
| `settings.js` | Platform settings in the `settings` table, provider presets, the encrypted AI key |
| `ai.js` | System prompt, task modes, tools, and LangChain-backed provider calls |
| `admin.js` | Everything under `/api/admin/*` |

Routes: `POST /api/auth/signup | login | logout`, `GET /api/me`, `GET /api/projects`, `GET | PUT | DELETE /api/projects/:id`,
`POST /api/ai`, and `/api/admin/*` (stats, activity, health, users, projects, settings, claim).
The database schema lives in `migrations/` (one numbered file per change; apply with `wrangler d1 migrations apply`).

## AI providers

The administrator configures Groq or Gemini as the primary model and can select the other as a fallback. Only those two providers
are accepted by the settings API. Provider keys are encrypted in D1 and never sent to the browser. Both use LangChain's
`ChatOpenAI` integration and the browser-facing message format remains text, `tool_use` and `tool_result` blocks. The AI panel
offers conversation, build, explain, test and debug modes; their task-specific instructions are added server-side.

## AI agent

The browser sends the chat and a compact summary of the entire canvas to `/api/ai`. Projects support AI builds of up to 1,000
parts and 5,000 wires; model input fitting trims old conversation turns and routes requests that exceed the estimated Groq
token budget to Gemini when a fallback key is configured. When the model asks for a destructive circuit tool
(`build_circuit`, `load_template` or `clear_circuit`) while a circuit exists, the browser shows a change preview and waits for
the user to apply or cancel before running it. The assistant shows brief progress in one message bubble and replaces it with
the final response when done; internal reasoning is not displayed. Tool execution repeats for at most 8 rounds.

## Versioning and caching

`npm run build` stamps `?v=<hash>` on scripts and styles and writes the same hash into `sw.js`, so every deployment gets
fresh files. Scripts and styles are cached for a year (they are versioned); `index.html` and `sw.js` are never cached.

## Live collaboration (added)

- `public/js/merge.js` is the merge engine (items with timestamps, no DOM). `public/js/collab.js` is the share box, presence bar, chat, voice, history and the WebRTC mesh. app.js exposes `window.LogicLabHost` and calls `window.LogicLabHook`; view-only mode is the `RO` flag in app.js (UI guards plus a revert in `commit()`).
- `server/collab.js` (share links, rooms, signalling, saving), `server/history.js` (versions), `server/store.js` (optional MongoDB bridge). `mongo-worker/` is the separate Worker that talks to Atlas. See COLLABORATION.md.

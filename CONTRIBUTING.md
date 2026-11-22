# Contributing to LogicLab

Thanks for helping! This guide gets you from clone to pull request.

## Setup

```bash
npm install
npx playwright install chromium   # one-time, for the tests
npm run dev                       # app on http://localhost:8788
npm test                          # must pass before you open a pull request
```

## Code style

Prettier formats everything (`npm run format`); `npm run check` fails if a file is not formatted.
Keep functions small, name things for what they mean, and add a short comment above any function whose purpose
is not obvious from its name. `public/js/app.js` is a single script: use the section banners to find your way.

## Add an example circuit

Open `public/js/examples.js` and add an entry with `add({...})`:

```js
add({
  id: 'my-circuit', // lowercase slug: used in URLs, thumbnails and tests
  title: 'My circuit', cat: 'Combinational', level: 'Easy',
  ref: 'https://en.wikipedia.org/wiki/...', // public page about the design
  desc: 'One sentence that says what it does.',
  expr: ['Y = A·B'],                          // boolean expressions
  check: function (i) { return { Y: i.A & i.B }; }, // expected outputs for each input combination
  build: function (b) {
    b.sw('A', 1); b.sw('B', 0);
    b.gate('AND', 'G1', ['A', 'B']);
    b.led('Y', 'G1');
  }
});
```

Rules: unique `id` and `title`, no duplicate of an existing circuit, ids and names of 12 characters or fewer,
and a `check` function for purely combinational circuits (the test suite tries every input combination).
For sequential circuits add a test to `tests/engine.test.mjs` (see the counters and registers there).
Add a `learn: { what, how }` block if you want a static guide page for it. Then run:

```bash
npm run assets   # thumbnail for the new example
npm run build    # learn page and sitemap
npm test
```

## Change the simulator

The engine lives in `step`, `comb`, `settle` and `rc` in `public/js/app.js` (see `docs/ARCHITECTURE.md`).
Every change to timing or evaluation order must keep `npm test` green: the tests check all gates, every example,
the flip-flop edge behaviour, race conditions and the oscillation warning.

## Change the database

Add a new numbered file in `migrations/` (for example `0003_something.sql`). Never edit a migration that was already released.
Apply it locally with `npm run dev` and in production with `npx wrangler d1 migrations apply logiclab --remote`.

## Pull requests

Keep them focused, describe what you tested, and add screenshots for visible changes. By contributing you agree that
your work is released under the MIT licence.

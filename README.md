# LogicLab: Digital Electronics Suite

A free, open-source logic circuit simulator that runs in your browser. Build circuits from gates and flip-flops,
watch them run, read truth tables and waveforms, and switch between schematic, transistor, breadboard and PCB views.
It works offline, and signed-in users can sync projects and use an AI assistant.

**Live app:** [https://logiclab.anogre.com/](https://logiclab.anogre.com/)

**Source code:** [github.com/Anugrah-Jacob/LogicLab](https://github.com/Anugrah-Jacob/LogicLab) · MIT License

- **Simulator:** switches, clocks, LEDs, voltmeters, AND/OR/NOT/NAND/NOR/XOR/XNOR gates, D/T/JK flip-flops, shift registers
- **Analysis:** truth tables, Boolean equations, K-maps, state tables, waveform viewer, oscillation warning
- **Real-voltage mode:** logic levels, RC rise/fall times and 30%/70% thresholds
- **Main power and Reset:** ON/OFF sets every output to 0 V and clears all memory; Reset restarts the circuit and the waveform
- **Adjustable panels:** drag the handles between the panels (sizes are remembered; double-click resets)
- **37 verified example circuits** (adders, comparators, multiplexers, decoders, latches, master-slave flip-flops, counters, shift registers)
- **Tools:** undo/redo, groups, snap-to-grid, drawing layers, convert to NAND-only or NOR-only, export PNG/PDF/project file
- **Cloud (optional):** accounts, offline-first sync, LogicLab AI that can build and test circuits for you
- **Admin panel (`/admin/`):** dashboard, user management, circuit list, AI usage, and AI provider settings (Anthropic, OpenAI, Groq, OpenRouter, NVIDIA Build, Together or any OpenAI-compatible service)
- **Learn pages:** static guides with truth tables, generated from the example library (good for search engines)

## Setup

New here? Follow the **[step-by-step setup guide](docs/SETUP_GUIDE.md)**. It covers installing the tools, running everything
locally, deploying to Cloudflare Pages, creating the first administrator, adding your AI key in the admin panel, a custom domain, backups and troubleshooting.

The short version:

```bash
npm install
cp .dev.vars.example .dev.vars     # set JWT_SECRET and ADMIN_SETUP_CODE
npm run dev                        # http://localhost:8788 (admin panel at /admin/)
```

To try only the simulator (no accounts), serve the `public/` folder with any static server: `npx serve public`.

Deploying:

```bash
npx wrangler d1 create logiclab                        # copy the database_id into wrangler.toml
npx wrangler d1 migrations apply logiclab --remote
SITE_URL=https://your-domain.com npm run build
npx wrangler pages project create logiclab --production-branch main
npx wrangler pages deploy public --project-name logiclab
npx wrangler pages secret put JWT_SECRET --project-name logiclab
npx wrangler pages secret put ADMIN_SETUP_CODE --project-name logiclab
npx wrangler pages deploy public --project-name logiclab      # redeploy so the secrets apply
```

Then sign up on your site, open `/admin/`, claim administrator with the setup code, and add the AI provider and key under Settings.

## Project layout

| Path                      | What it is                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `public/index.html`       | App shell, welcome screen, SEO tags, structured data                               |
| `public/js/app.js`        | The application (simulator, editor, accounts, sync, AI). Start at its table of contents |
| `public/js/examples.js`   | The example library: every circuit is a few lines of data                          |
| `public/js/config.js`     | Site settings (repository link, ads switch)                                        |
| `public/css/app.css`      | App styles; `learn.css` styles the static pages                                    |
| `public/sw.js`            | Service worker for offline use                                                     |
| `public/learn/`           | Generated guide pages (do not edit by hand)                                        |
| `functions/api/[[path]].js` | API router (thin)                                                                 |
| `server/`                 | Backend logic: auth, projects, AI providers, settings, admin                        |
| `migrations/`             | Database schema, one numbered file per change                                      |
| `public/admin/`           | The admin panel                                                                    |
| `scripts/`                | `build.mjs` (SEO files, versions), `build-assets.mjs` (thumbnails, icons)          |
| `tests/`                  | Engine, UI and cloud tests                                                         |
| `docs/`                   | Architecture, debugging, SEO and monetization notes                                |

## Everyday commands

| Command              | Purpose                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `npm run dev`        | Run the app with the local database                                      |
| `npm test`           | Verify the simulation engine, power/reset, every example circuit, the UI and the SEO output |
| `npm run test:cloud` | Test accounts, sync, offline editing and the AI loop (needs `npm run dev`) |
| `npm run test:admin` | Test the admin panel, user management, provider settings and AI providers (needs `npm run dev` on a fresh database) |
| `npm run check`      | Formatting and syntax checks                                             |
| `npm run format`     | Format the code with Prettier                                            |
| `npm run build`      | Regenerate learn pages, sitemap, robots.txt, llms.txt and asset versions |
| `npm run assets`     | Regenerate example thumbnails, icons and the social image                |

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md); adding an example circuit takes about ten lines.
Please follow the [Code of Conduct](CODE_OF_CONDUCT.md) and report security problems as described in [SECURITY.md](SECURITY.md).

## Credits and licence

MIT licensed, see [LICENSE](LICENSE). The example circuits are standard textbook designs; each one links to a public
reference page (mostly Wikipedia). The logo and name are part of this project.

## Sharing and live collaboration

Share a project as view-only or editable with one link, edit together live, chat, talk (WebRTC voice) and restore earlier versions. Project data can live in MongoDB Atlas while logins and the project list stay in Cloudflare D1. See [docs/COLLABORATION.md](docs/COLLABORATION.md).

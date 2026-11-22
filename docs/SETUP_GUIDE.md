# Step-by-step setup guide

This guide takes you from nothing to a live LogicLab site with accounts, an admin panel and AI. You do not need to
know Cloudflare already. Every step says what to type and what you should see.

Time: about 30 minutes. Cost: Cloudflare's free plan is enough to start. AI providers may charge for usage (some,
such as Groq and NVIDIA Build, have free tiers; check their pricing pages).

---

## Part 1. Install the tools

You need **Node.js 20 or newer** and a terminal. Git is optional but recommended.

| System | How |
| --- | --- |
| Windows | Install Node.js from https://nodejs.org (the LTS version). Use "Command Prompt" or PowerShell. |
| macOS | Install Node.js from https://nodejs.org, or `brew install node`. Use the Terminal app. |
| Linux / ChromeOS (Linux terminal) | `sudo apt update && sudo apt install -y nodejs npm git` (if `node -v` is older than 20, install Node from https://nodejs.org or with `nvm`). |

Check it worked:

```bash
node -v      # should print v20 or higher
npm -v
```

## Part 2. Get the code and look at it

1. Unzip `logiclab.zip` and open a terminal in the `logiclab` folder.
2. Install the helper tools (Wrangler is Cloudflare's command-line tool):

   ```bash
   npm install
   ```

3. Quick look without accounts or a server:

   ```bash
   npx serve public
   ```

   Open the address it prints. You can already build and simulate circuits. Press `Ctrl+C` to stop.

## Part 3. Create the accounts you need

1. **Cloudflare** (required): sign up free at https://dash.cloudflare.com/sign-up and confirm your email.
2. **GitHub** (optional, for automatic deploys): https://github.com/signup.
3. **An AI provider** (optional now, you can add it later in the admin panel). Create an API key at one of:
   - Groq: https://console.groq.com/keys
   - OpenRouter: https://openrouter.ai/keys
   - NVIDIA Build: https://build.nvidia.com (sign in, open a model, "Get API key")
   - Anthropic (Claude): https://console.anthropic.com
   - OpenAI: https://platform.openai.com/api-keys

   Keep the key private. You will paste it into the admin panel, never into the code.

## Part 4. Run everything on your computer first

1. Make your secrets file:

   ```bash
   cp .dev.vars.example .dev.vars
   ```

2. Make two long random strings and put them in `.dev.vars`:

   ```bash
   node -e "console.log(require('crypto').randomBytes(36).toString('base64'))"
   ```

   Run it twice. Put the first result after `JWT_SECRET=` and the second after `ADMIN_SETUP_CODE=`.
   (`JWT_SECRET` protects sessions and the saved AI key. `ADMIN_SETUP_CODE` lets you become the first administrator.)

3. Start the app. This also creates the local database:

   ```bash
   npm run dev
   ```

   Wait for `Ready on http://localhost:8788`, then open it.
4. Click **Sign in**, then **Sign up**, and create your account.
5. Open http://localhost:8788/admin/ . It says "Become the administrator". Paste your `ADMIN_SETUP_CODE` and press
   **Claim administrator**. You now see the dashboard.
6. Go to **Settings**, pick your AI provider, check the model name, paste the key, press **Save**, then
   **Test connection**. You should see "Connected in ... ms".
7. Back in the app press **✦ AI** and try "Design a 4-bit adder". The assistant should build it on the canvas.

If something fails, see the troubleshooting table at the end.

## Part 5. Put it on the internet (Cloudflare Pages)

Run these in the project folder. Replace `your-domain.com` with the address you will use. If you do not have a
domain yet, use `logiclab.pages.dev` (Cloudflare gives you `<project-name>.pages.dev` for free; if the name is taken
choose another project name and use that).

1. Log in:

   ```bash
   npx wrangler login
   ```

   A browser window opens; click **Allow**.
2. Create the database:

   ```bash
   npx wrangler d1 create logiclab
   ```

   It prints a `database_id`. Open `wrangler.toml` and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with it.
3. Create the tables:

   ```bash
   npx wrangler d1 migrations apply logiclab --remote
   ```

   Answer `y` when asked.
4. Build the site files for your address (sets canonical links, the sitemap and the learn pages):

   ```bash
   SITE_URL=https://your-domain.com npm run build
   ```

   On Windows PowerShell use: `$env:SITE_URL="https://your-domain.com"; npm run build`
5. Create the Pages project and deploy:

   ```bash
   npx wrangler pages project create logiclab --production-branch main
   npx wrangler pages deploy public --project-name logiclab
   ```

6. Add the secrets (the command asks you to paste each value; use new random strings, not your local ones):

   ```bash
   npx wrangler pages secret put JWT_SECRET --project-name logiclab
   npx wrangler pages secret put ADMIN_SETUP_CODE --project-name logiclab
   npx wrangler pages secret put GEMINI_API_KEY --project-name logiclab
   ```

   `GEMINI_API_KEY` is the backup for Groq rate limits. LogicLab keeps Groq as the primary provider and returns to it
   automatically when its shared limit resets. If Gemini fallback is not needed, omit this secret.

7. Deploy once more so the secrets take effect:

   ```bash
   npx wrangler pages deploy public --project-name logiclab
   ```

8. Open your site, sign up, then open `/admin/` and claim administrator with your setup code.
9. In **Settings** choose the AI provider, paste the key, **Save** and **Test connection**.
10. Remove the setup code so nobody can reuse it:

    ```bash
    npx wrangler pages secret delete ADMIN_SETUP_CODE --project-name logiclab
    ```

    (It already stops working once an administrator exists, so this is an extra safety step.)

Your site is live. Open **System** in the admin panel: every row should say OK.

## Part 6. Automatic deploys from GitHub (optional)

1. Create an empty repository on GitHub and push the project:

   ```bash
   git init && git add . && git commit -m "LogicLab"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/logiclab.git
   git push -u origin main
   ```

2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, choose the repository.
3. Build settings: framework preset **None**, build command `node scripts/build.mjs`, output directory `public`.
4. Under **Settings → Variables and Secrets** add `SITE_URL` (plain text, your address), and `JWT_SECRET` and
   `ADMIN_SETUP_CODE` as **Secrets**.
5. Under **Settings → Bindings** add a **D1 database** binding named `DB` and select the `logiclab` database.
6. Redeploy. From now on every push to `main` deploys automatically.

Whenever you add database migrations in the future, run `npx wrangler d1 migrations apply logiclab --remote`.

## Part 7. Your own domain

1. In the Cloudflare dashboard open your Pages project, then **Custom domains → Set up a custom domain**.
2. Follow the instructions (if the domain is already on Cloudflare it takes one click).
3. Rebuild with the final address and redeploy: `SITE_URL=https://your-domain.com npm run build`, then
   `npx wrangler pages deploy public --project-name logiclab`.
4. Add the site to Google Search Console and submit `https://your-domain.com/sitemap.xml`.

## Part 8. Everyday admin work

Open `/admin/` (or the avatar menu in the app, then **Admin panel**). See [ADMIN.md](ADMIN.md) for every page.

| I want to... | Where |
| --- | --- |
| See users, circuits and AI usage | Dashboard |
| Add, disable, delete a user, reset a password, make someone an admin | Users |
| Change AI provider, model or key | Settings → AI provider |
| Limit how much each person can use the AI | Settings (everyone) or Users → Edit (one person) |
| Stop strangers creating accounts | Settings → Accounts, untick "Anyone can create an account" |
| Check that everything is configured | System |

AI provider presets and what to know:

| Provider | Base URL (already filled in) | Example model |
| --- | --- | --- |
| Anthropic (Claude) | https://api.anthropic.com | `claude-sonnet-5-5` |
| OpenAI | https://api.openai.com/v1 | `gpt-4o-mini` |
| Groq | https://api.groq.com/openai/v1 | `llama-3.3-70b-versatile` |
| OpenRouter | https://openrouter.ai/api/v1 | `openai/gpt-4o-mini` |
| NVIDIA Build | https://integrate.api.nvidia.com/v1 | `meta/llama-3.3-70b-instruct` |
| Together AI | https://api.together.xyz/v1 | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| Custom | any OpenAI-compatible `/v1` address | your model |

Model names change over time. If **Test connection** says "model not found", open your provider's model list and copy
the current name. Choose a model that supports **tool / function calling**, because that is how the assistant builds
circuits.

## Part 9. Updating later

1. Replace the project files with the new version (keep your `wrangler.toml` database id).
2. `npm install`
3. `npx wrangler d1 migrations apply logiclab --remote` (does nothing if there are no new migrations)
4. `SITE_URL=https://your-domain.com npm run build`
5. `npx wrangler pages deploy public --project-name logiclab`

## Part 10. Backups

```bash
npx wrangler d1 export logiclab --remote --output=backup.sql
```

Keep that file somewhere safe. It contains user accounts (password hashes), projects and the encrypted AI key.

## Part 11. Security checklist before you tell people

- [ ] `JWT_SECRET` is long and random, and is not the one from your local `.dev.vars`.
- [ ] The setup code secret is deleted after you became administrator.
- [ ] A Cloudflare rate-limiting rule protects `/api/auth/*` and `/api/ai` (Security → WAF → Rate limiting rules).
- [ ] Your AI provider account has a monthly spending limit.
- [ ] You set a sensible daily AI limit in Settings.
- [ ] You decided whether sign-ups stay open.

Changing `JWT_SECRET` later signs everyone out and makes the saved AI key unreadable; you would paste the key again in Settings.


## Part 12. Sharing, live editing and MongoDB (new)

The Share button, live editing, chat, voice and version history need one more database step and, optionally, MongoDB:

1. Apply the new migration (adds share links and history): `npx wrangler d1 migrations apply logiclab --remote`
2. Rebuild and redeploy (Part 9, steps 4 and 5). Admin → System should now say "Live collaboration tables: OK".
3. Optional: keep the project data in MongoDB Atlas instead of D1. D1 keeps logins and the project list; MongoDB keeps the circuit JSON.
   Follow [COLLABORATION.md](COLLABORATION.md), part "Turning on MongoDB".

Voice needs a secure (https) address, which Cloudflare Pages gives you. Everything else keeps working if you skip step 3.


## Troubleshooting

| What you see | What to do |
| --- | --- |
| `D1 binding "DB" is not configured` | Check the `database_id` in `wrangler.toml`, or add the `DB` binding in the dashboard (Part 6, step 5), then redeploy. |
| "Server error" on sign-up, or the System page says migrations are missing | Run `npx wrangler d1 migrations apply logiclab --remote`. |
| Everyone is signed out after a deploy | `JWT_SECRET` was changed or is missing. Set it again. |
| "ADMIN_SETUP_CODE is not set" on the claim page | Add the secret (Part 5, step 6) and redeploy. |
| "An administrator already exists" | Ask that administrator to promote you on the Users page. |
| AI says "not configured yet" | Admin → Settings: save a key, then **Test connection**. |
| Test connection: `Provider error (401)` | The key is wrong or for another provider. Paste it again. |
| Test connection: `Provider error (404)` or "model not found" | Use a current model name from your provider. |
| Test connection: `Provider error (400)` about tools | The model does not support tool calling. Choose another model. |
| AI says "Daily AI limit reached" | Raise the limit in Settings or for that user. |
| You see an old version of the site | In the browser: DevTools → Application → Service Workers → Unregister, then reload. Deploys normally update on their own. |
| `npm run dev` says port in use | Close the other copy, or run `npx wrangler pages dev public --port 8790`. |
| A person shows a red dot ("Can't connect") | Their network blocks direct connections. Add a TURN relay (COLLABORATION.md). |
| Share button says to sync first, or sharing shows an error | Wait for "Synced" in the header, and make sure you ran the 0003 migration (Part 12). |
| A person shows a red dot ("Can't connect") | Their network blocks direct connections. Add a TURN relay (COLLABORATION.md). |
| Tests say "Cannot find package playwright" | Run `npm install` then `npx playwright install chromium`. |

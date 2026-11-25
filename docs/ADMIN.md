# Admin panel guide

Open `/admin/` on your site. Only administrators can use it.

## Becoming the first administrator

1. Set the `ADMIN_SETUP_CODE` secret (see [SETUP_GUIDE.md](SETUP_GUIDE.md)).
2. Create a normal account on the site and stay signed in.
3. Open `/admin/`, enter the setup code, press **Claim administrator**.

The claim only works while no administrator exists. After that, administrators promote other people on the Users page.

## Pages

- **Dashboard**: totals (users, circuits, AI requests, built-in examples), a 30-day chart of new users, circuits and AI requests, system status, recent activity, popular templates (counted from projects that started from a template) and the split between users, administrators and disabled accounts.
- **Users**: search, add a user (you choose their password), edit name, role and personal AI limit, reset a password, disable or enable an account, delete an account with all its circuits.
- **Circuits**: every project that users have synced, with owner, type, size and the template it started from. You can delete one.
- **AI usage**: requests per day for 30 days and the top users.
- **Settings**: Groq/Gemini provider and model, encrypted API keys, daily limit, AI on/off, and whether anyone can sign up.
- **System**: health checks for the database, migrations, secrets and the AI provider.

The sidebar can be collapsed with the menu button; the choice is remembered.

## The AI provider and key

- The key is encrypted with a key derived from `JWT_SECRET` before it is stored in the database. It is never sent back to any browser; the form only shows the last four characters.
- Settings has a primary Groq or Gemini provider and an optional fallback to the other. When the primary is rate-limited or unavailable, LogicLab tries the fallback if its key is configured. Each key is encrypted separately.
- **Test connection** sends one tiny request with your saved settings and reports success, the time it took, or the provider's error.
- You can switch providers at any time. Every user's chat keeps working.
- The server can also use `GROQ_API_KEY` or `GEMINI_API_KEY` secrets if a key is not saved in Settings.
- Both providers use the OpenAI-compatible chat API with tool calling through LangChain.

## Limits

- Everyone gets the **daily AI limit** from Settings. A user's personal limit (Users → Edit) overrides it; set 0 to block one person.
- Administrators are protected from lock-out: you cannot delete or disable yourself, and the last active administrator cannot be demoted, disabled or deleted.
- Disabling an account stops its existing sessions immediately.

## What the admin panel does not do

It does not edit the tutorials or the example library (those are files in the repository), and it does not show how many simulations people run, because simulations run inside each visitor's browser and are not sent to the server.

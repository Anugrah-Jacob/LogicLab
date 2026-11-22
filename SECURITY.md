# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's "Report a vulnerability" button on the
repository's Security tab, or email the maintainer address you set for your fork. Include steps to reproduce.
You will get an answer within a few days.

## What is in scope

The browser app (`public/`) and the API (`functions/api/`): accounts, sessions, project sync and the AI proxy.

## Built-in protections

- Passwords: PBKDF2-SHA256, 100,000 iterations, random salt per user, constant-time comparison.
- Sessions: HMAC-signed cookie, `HttpOnly; Secure; SameSite=Lax`.
- Login throttle: 8 failed attempts per email per 15 minutes. Cross-site `Origin` headers are rejected.
- Strict Content-Security-Policy (`public/_headers`): scripts only from the same origin, no inline scripts.
- `JWT_SECRET` lives in a Cloudflare secret. The AI provider key is saved by an administrator, encrypted (AES-GCM, key derived from `JWT_SECRET`) in the database, and never sent to a browser.
- Admin routes check the administrator role on every request; disabled accounts lose their sessions immediately; the last active administrator cannot be removed.
- Provider base URLs must be https (http only for localhost).

## Before you go public

Add a Cloudflare rate-limiting rule for `/api/auth/*` and `/api/ai`, consider Turnstile on sign-up, and set a
spending limit on your AI provider account.

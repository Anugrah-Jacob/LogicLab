# logiclab-mongo (optional storage Worker)

Keeps the project data (the circuit JSON and history versions) in MongoDB Atlas.
Cloudflare D1 keeps logins, the project list and share links. See `../docs/COLLABORATION.md`, part "MongoDB".

```bash
cd mongo-worker
npm install
npx wrangler secret put MONGODB_URI   # Atlas connection string
npx wrangler secret put API_KEY       # any long random string
npx wrangler deploy                   # prints https://logiclab-mongo.<you>.workers.dev
```
In Atlas: Network Access must allow the connection (use `0.0.0.0/0`, Workers have no fixed address) and the database
user needs read/write on the `logiclab` database.

Then on the LogicLab Pages project add `MONGO_API_URL` (the Worker address) and the secret `MONGO_API_KEY`
(the same string as `API_KEY`) and redeploy. Admin → System shows "MongoDB (project storage)".

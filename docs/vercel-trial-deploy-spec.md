# Spec: Trial deployment of alliance-stats-tracker on Vercel (Hobby, free)

## Goal

Stand up a **second, parallel** deployment of the app on Vercel so Frans can
compare real-world load times against the current Render free-tier
deployment before deciding whether to cut over. **Render is not touched at
any point in this spec** — it keeps running exactly as it does today. This
is purely additive: a second URL to compare against the first.

Repo: `https://github.com/framen777-web/LastWar.git` (branch `master`) —
confirmed from `.git/config`. Render already deploys from this same repo,
so Vercel can import it the same way without any repo restructuring.

## The one code change needed

Render's `buildCommand` in `render.yaml` explicitly runs
`npx prisma generate` before `next build`. Vercel's default Next.js build
does **not** know to do this on its own — without it, the Prisma Client
won't exist at build time and the build will fail with a "did you forget to
run prisma generate" error.

The standard, portable fix (works on Vercel, and is a harmless no-op
addition on Render, which already generates explicitly in its own build
command) is a `postinstall` script, which runs automatically after every
`npm install`/`npm ci` on any platform:

**File: `package.json`** — add a `postinstall` line to the `scripts` block
(currently `dev`, `build`, `start`, `lint`):

```diff
   "scripts": {
     "dev": "next dev",
     "build": "next build",
     "start": "next start",
+    "postinstall": "prisma generate",
     "lint": "eslint"
   },
```

That's the only file this spec touches. Nothing else in the codebase needs
to change to stand up the trial.

## Vercel project setup (dashboard, no CLI needed)

1. Go to vercel.com, sign up/log in with the GitHub account that owns
   `framen777-web/LastWar` (Hobby plan, no card required).
2. **Add New... → Project → Import Git Repository**, select
   `framen777-web/LastWar`. Grant the Vercel GitHub App access to that repo
   if prompted.
3. Vercel auto-detects the Next.js framework preset. Leave Root Directory
   as the repo root (that's where `package.json` lives) and leave the
   build/install commands on their defaults — the `postinstall` script
   above handles `prisma generate` automatically, no need to override
   Vercel's Build Command.
4. **Before clicking Deploy**, add the environment variables below (Vercel
   lets you set these on the same "Configure Project" screen, or in
   Project Settings → Environment Variables afterward).

## Environment variables to set in Vercel

Mirrors `render.yaml`'s `envVars` block, with one deliberate difference
(`DATABASE_URL`) and one required change (`APP_BASE_URL`):

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Same Neon database, **pooled** connection string | See "About DATABASE_URL" below — this is the one setting that actually matters for correctness under serverless load. |
| `AUTH_SECRET` | Same value as currently set in Render's dashboard | Fine to reuse — Vercel's cookies are scoped to the Vercel domain anyway, so this doesn't let sessions leak between the two deployments. |
| `GEMINI_API_KEY` | Same value as Render (or leave unset and set it later from the app's own Settings page, same as Render) | Optional per the existing render.yaml comment. |
| `RESEND_API_KEY` | Same value as Render | |
| `APP_BASE_URL` | The Vercel deployment's own URL, e.g. `https://<your-project-name>.vercel.app` | **Must not** be the Render URL — this drives the absolute link built into forgot-password emails. Vercel assigns the exact URL on first deploy; if you set this before the first deploy, use the predictable `https://<project-name>.vercel.app` pattern (matches the project name you chose at import time), then double check it after the first deploy completes. |
| `NODE_ENV` | Don't set manually | Vercel sets this itself for production deployments. |

### About `DATABASE_URL` — pooled vs. direct

Render's Node process holds a small, stable number of long-lived DB
connections. Vercel's serverless functions don't — many short-lived
function invocations can each open their own connection, and Neon's direct
connection endpoint has a low connection ceiling that gets exhausted fast
under that pattern (you'd see intermittent "too many connections" errors).

Fix: in the Neon dashboard, open the same "lastwar" project's **Connection
Details**, and toggle to the **Pooled connection** string instead of
Direct (the pooled host has `-pooler` in it, e.g.
`...-pooler.eu-central-1.aws.neon.tech`). Use that as `DATABASE_URL` in
Vercel. This is the only connection-string change — same database, same
data, just the pooled endpoint. `@prisma/adapter-pg` + `pg` (already in
`package.json`, unchanged) work against the pooled endpoint exactly the
same as the direct one from the app's point of view.

### Should the trial point at the real production database?

Worth deciding before deploying:

- **Simplest — same database as Render.** Zero extra setup. Fine for
  comparing load/cold-start behavior and clicking through pages read-only.
  If you actively upload screenshots or edit data during testing, though,
  that's real production data going in twice (once conceptually "for
  testing"), same as it would be if you tested on Render itself.
- **Isolated — a Neon database branch.** Neon's free tier includes
  instant, git-like database branching — a few seconds to create a full
  copy of current data that's completely separate from production, so you
  can upload test screenshots, create test members, etc. without any risk.
  If you want this, create the branch from the Neon dashboard first and
  use *that* branch's pooled connection string as `DATABASE_URL` instead.

Either is fine for this trial — pick based on whether you plan to just
browse/time page loads, or actually exercise the upload pipeline.

## What to actually test once it's deployed

1. **Cold-start comparison** — the actual point of this trial. Let both
   the Render app and the new Vercel deployment sit idle for 15+ minutes
   (Render's spin-down threshold), then load each and compare. Vercel has
   no equivalent "sleeping container" state, so this should be dramatically
   faster — but confirm it in practice rather than taking my word for it.
2. **Login / auth flow** — sessions won't carry over between the two
   domains (expected, cookies are domain-scoped), but confirm logging in
   fresh on the Vercel URL works normally.
3. **Screenshot upload → Gemini extraction pipeline** — if you go the
   database-branch route above, upload a real screenshot and confirm
   `runPipelineForImage` completes normally. Vercel's function duration
   default (300 seconds on Hobby, per Vercel's current docs) comfortably
   covers this, but it's worth actually seeing it work once rather than
   assuming.
4. **A report/export page** (e.g. an Excel export) — confirms `exceljs`
   and the heavier server-side pages behave the same as on Render.

## After the trial

This spec deliberately stops here — it stands up a comparison, nothing
more. Once Frans has seen it perform better, the follow-up (a separate,
later spec) would cover the actual cutover: pointing the alliance at the
Vercel URL as the real one (custom domain if wanted), and only then
deciding what to do with the Render service (keep as a spare, or shut it
down). No need to decide that now.

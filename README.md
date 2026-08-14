# Alliance Stats Tracker (MVP)

Uploads alliance screenshots, classifies them, extracts structured data via
Gemini vision, and stores results in Postgres. See
`H:\My Drive\War\Last War App\design-spec.md` for the full design spec this
implements a first slice of.

## Setup

1. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (a Postgres
   connection string - see `.env.example` for where to get one).
2. Copy `.env.local.example` to `.env.local` and fill in `GEMINI_API_KEY`
   (get one from [Google AI Studio](https://aistudio.google.com/apikey)) and
   `AUTH_SECRET`.
3. `npm install` (already done if you're reading this after the initial build)
4. `npx prisma db push` to create the schema in your Postgres database.
5. `npm run dev`, then open [http://localhost:3000](http://localhost:3000)

Deploying: see `render.yaml` (Render Blueprint - web service + managed
Postgres). Migrating existing data from an old local SQLite `dev.db` into a
fresh Postgres database: `npx tsx scripts/migrate-to-postgres.ts` (one-time,
see the comment at the top of that file).

## Pages

- `/upload` — pick a week number and drop screenshots; runs classify →
  extract → validate → write per image and shows the result
- `/dashboard` — table of member stats for a given week
- `/raw` — every extraction result with its source image, confidence, and
  status — the audit trail behind the dashboard numbers

## What's implemented (MVP scope)

- Tier A structured categories only: Power, Kills, Donations, VS,
  Desert Storm, AE, Members
- Category registry lives in the `Category` DB table (`prisma/seed.ts`),
  not hardcoded switch statements — new categories are a DB row + a prompt
  in `lib/ai/prompts.ts`, not a code rewrite
- Fuzzy member-name matching (`lib/pipeline/matchMember.ts`) against the
  roster, auto-creating new members when nothing matches closely
- Alliance rank (R1-R5) captured opportunistically from any screenshot and
  upserted onto the member record, independent of that screenshot's category
- Re-uploading a screenshot for the same member/week/category overwrites
  rather than duplicates

## Explicitly deferred (not built yet)

- Auth / roles (Admin / Officer / Member)
- Manual Edits correction queue
- The "needs setup" review screen for unrecognized screenshot categories
  (unknown/low-confidence screenshots currently just land in `/raw` with
  `status = needs_review`)

## Stack notes

- Next.js 16 (App Router) + TypeScript + Tailwind
- Prisma 7 + Postgres via the `@prisma/adapter-pg` driver adapter (Prisma 7
  requires an explicit driver adapter; deploys to Render, see `render.yaml`)
- `@google/genai` (the current Google AI SDK — `@google/generative-ai` is
  the deprecated predecessor) for classify/extract vision calls

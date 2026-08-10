# Alliance Stats Tracker (MVP)

Uploads alliance screenshots, classifies them, extracts structured data via
Gemini vision, and stores results in a local SQLite DB. See
`H:\My Drive\War\Last War App\design-spec.md` for the full design spec this
implements a first slice of.

## Setup

1. Copy `.env.local.example` to `.env.local` and fill in `GEMINI_API_KEY`
   (get one from [Google AI Studio](https://aistudio.google.com/apikey)).
2. `npm install` (already done if you're reading this after the initial build)
3. `npm run dev`, then open [http://localhost:3000](http://localhost:3000)

The SQLite database lives at `prisma/dev.db` (gitignored). To reset it:

```bash
npx prisma migrate reset
```

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
- Tier B free-text parsing (Squads/troop-% announcements)
- Conductor weighted report, Promote/Watch derived views
- Supabase/Postgres migration and Vercel deployment — this runs entirely
  locally against SQLite for now

## Stack notes

- Next.js 16 (App Router) + TypeScript + Tailwind
- Prisma 7 + SQLite via the `@prisma/adapter-better-sqlite3` driver adapter
  (Prisma 7 requires an explicit driver adapter even for SQLite)
- `@google/genai` (the current Google AI SDK — `@google/generative-ai` is
  the deprecated predecessor) for classify/extract vision calls

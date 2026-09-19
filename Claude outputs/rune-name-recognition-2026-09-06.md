# RUNE — Name recognition: dropped suffix badge + garbled fancy-glyph names

Follow-up to today's earlier spec, same workflow — read against the actual current
`lib/ai/prompts.ts`, `lib/ai/gemini.ts`, `lib/pipeline/matchMemberCore.ts` on your machine.

## What I found

Your screenshot has two different failures, and they have two different causes.

**"Ronlan pfal" → recorded as "Ronlan"** — the small superscript text right after a name
(a title/badge, in a visibly smaller font) isn't mentioned anywhere in the extraction
prompt at all. `lib/ai/prompts.ts`'s `buildExtractionPrompt()` (the `ranking_list`/`roster`
branch, lines 181-185) only tells the model about two things next to a name: the R1-R5
alliance-rank badge, and a bracketed `[TAG]` alliance prefix on the *same line* as the
name. It says nothing about a small suffix badge like "pfal", so the model has no
instruction either way and is dropping it as if it were decoration. This is a real,
fixable prompt gap — the fix below is a one-line addition to the prompt.

**"xƏ丹ηկ૬GGIx" → recorded as "x", "x x x", "x lx"** — this is a different kind of
problem. The Sep 2026 fix already in your code (`lib/ai/gemini.ts`: `thinkingBudget: 0`,
`maxOutputTokens: 8192`, `mediaResolution: MEDIA_RESOLUTION_HIGH`) targeted *truncation* —
the JSON response getting cut off mid-string. That's not what's happening here: a
truncated name would trail off after some prefix, not come back as "x lx" on one screenshot
and "x x x" on another while keeping both leading and trailing "x". What's actually
happening is the model genuinely can't parse the middle of this specific username — it's a
"fancy font" name deliberately built from lookalike glyphs across several scripts/symbol
blocks (the image shows what looks like a stylized Ə, a CJK character, and a few
Armenian/Cyrillic-lookalike letters mashed together). That's a vision/OCR capability limit
on this specific kind of deliberately-obfuscated text, not a bug in this app's code or
prompt — there's no prompt wording that fixes a model genuinely misreading a glyph.

The mechanical fallout of the second problem: `lib/pipeline/matchMemberCore.ts`'s
`findMemberId()` only allows fuzzy (typo-tolerant) matching for names 8+ normalized
characters long (`MIN_LENGTH_FOR_FUZZY_MATCH = 8`, lines 8 and 82) — anything shorter
requires an **exact** match to auto-link to an existing member. "x", "xxx", and "xlx" are
all under that length, so each differently-garbled reading of this same person creates a
new "ghost" member instead of updating one — this is the same "duplicate ghost members
from mis-transcribed names" issue already sitting in your project memory as
specced-but-unconfirmed, now with a second concrete real-world example. Lowering that
8-character threshold wouldn't safely help here — a 1-character name has essentially no
signal to fuzzy-match on, so loosening it risks silently merging two different short-named
people instead (exactly the "Inktest"/"minktest" bug that threshold was added to prevent).
I'm not proposing a code change for this part — the existing Merge screen is already the
right recovery tool for ghosts once you spot them, and the not-yet-deployed "Reject"
button spec will make cleaning up a bad auto-created member one click instead of a manual
merge.

## Fix 1 — `lib/ai/prompts.ts`, include adjacent suffix badges in the name

In `buildExtractionPrompt()`, the non-free_text branch (currently lines 181-185), the
first paragraph currently reads:

```
Extract every visible row/member exactly as shown. Read member names carefully (they may contain unusual characters/emoji — transcribe as best you can). Names in a non-Latin script (Arabic, Cyrillic, Chinese, etc.) must be copied exactly as they appear in that script — do not transliterate, romanize, or translate them into Latin letters. The same person's name has to come out character-for-character identical every time it's read, because it's used to automatically match this row to the right person across screenshots — even a different spelling or a switch to Latin letters will create a duplicate entry instead of updating theirs. Do not invent rows that aren't visible. If the "alliance_rank" (R1-R5) badge isn't visible for a member, omit that field for them rather than guessing. Member names are sometimes prefixed with the alliance's tag in brackets, e.g. "[RUNE] SomeName" — that bracketed tag is the alliance name, not part of the member's name; exclude it from "member_name"/"name" and report only the person's actual display name. Separately, also report that tag's text (without brackets) in "alliance_tag" if one was shown - e.g. "RUNE" - so a downstream check can tell who currently carries it. Omit "alliance_tag" entirely if the name had no bracket prefix.
```

Insert this sentence right after "...transcribe as best you can).", before the "Names in
a non-Latin script..." sentence:

```
Some names are followed immediately by a short word or short badge of text in a visibly smaller font (e.g. a player title) - that is part of what's displayed for that person, not decoration to skip; include it in "member_name"/"name" exactly as shown (with a single space before it), unless it's clearly the bracketed alliance tag described below, which is handled separately.
```

Full replacement paragraph (so there's no ambiguity about placement):

```
Extract every visible row/member exactly as shown. Read member names carefully (they may contain unusual characters/emoji — transcribe as best you can). Some names are followed immediately by a short word or short badge of text in a visibly smaller font (e.g. a player title) - that is part of what's displayed for that person, not decoration to skip; include it in "member_name"/"name" exactly as shown (with a single space before it), unless it's clearly the bracketed alliance tag described below, which is handled separately. Names in a non-Latin script (Arabic, Cyrillic, Chinese, etc.) must be copied exactly as they appear in that script — do not transliterate, romanize, or translate them into Latin letters. The same person's name has to come out character-for-character identical every time it's read, because it's used to automatically match this row to the right person across screenshots — even a different spelling or a switch to Latin letters will create a duplicate entry instead of updating theirs. Do not invent rows that aren't visible. If the "alliance_rank" (R1-R5) badge isn't visible for a member, omit that field for them rather than guessing. Member names are sometimes prefixed with the alliance's tag in brackets, e.g. "[RUNE] SomeName" — that bracketed tag is the alliance name, not part of the member's name; exclude it from "member_name"/"name" and report only the person's actual display name. Separately, also report that tag's text (without brackets) in "alliance_tag" if one was shown - e.g. "RUNE" - so a downstream check can tell who currently carries it. Omit "alliance_tag" entirely if the name had no bracket prefix.
```

Note: your screenshot actually shows the alliance info ("[RuNE] Remnants Unt New Era") on
its own line *below* the name, not as a same-line "[TAG] Name" prefix — that's a
kingdom/server-wide leaderboard layout, different from the same-alliance-roster layout the
`alliance_tag` instruction above was written for. If this screenshot is a category you
actually import (rather than just an example of the name problem), tell me and I'll check
whether `alliance_tag` is being captured correctly from that layout too — separate issue
from the name truncation, didn't want to bundle a guess about it into this fix.

## Fix 2 — try the more capable Gemini model (no code change)

For the badly-garbled fancy-glyph case, the highest-leverage thing to try costs no code
change at all: `lib/ai/gemini.ts` line 4 reads the model from an env var —
`process.env.GEMINI_MODEL ?? "gemini-2.5-flash"` — with no code path to override it except
that variable. Set `GEMINI_MODEL=gemini-2.5-pro` in the Vercel project's environment
variables and redeploy (an env var change on Vercel takes effect on the next deployment,
not instantly). Pro is slower and costs more per image than Flash, but this app's imports
no longer block your browser tab (today's other fix moved processing server-side), so the
extra per-image latency doesn't cost you anything you'd notice — you're not standing there
waiting on it either way. Re-upload the same problem screenshot after the redeploy and
see whether Pro reads "xƏ丹ηկ૬GGIx" correctly; if it still can't, that's about as strong
a signal as you'll get that this exact style of glyph-salad name is past what any current
model can reliably OCR, and the practical answer becomes "expect an occasional ghost
member for names like this, and merge it away when you spot it" rather than a fix to keep
chasing.

## Deploy checklist

1. Apply the `lib/ai/prompts.ts` prompt change above.
2. Bump `lib/version.ts`'s `MINOR` by 1 as part of this deploy (bundle it with today's
   other two fixes into one bump if you haven't deployed those yet).
3. Optionally set `GEMINI_MODEL=gemini-2.5-pro` in Vercel's env vars at the same time —
   independent of the prompt change, no code required, just redeploy to pick it up.
4. Re-upload a screenshot with a name that has a small suffix badge — confirm it now shows
   up in `member_name` (e.g. check `/raw` or `/review` for the raw extracted value, or
   just look at the member it matched/created).
5. Re-upload the "xƏ丹ηկ૬GGIx"-style screenshot again post-Pro-switch (if you make it) and
   see whether the reading is now consistent across re-uploads.
6. If you already have duplicate ghost members from past misreads of this same person
   (check Setup → Users / Merge for near-identical short garbled names), merge them once
   you're confident which ones are the same real person.

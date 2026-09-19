# RUNE — Improve matching for garbled/"squiggly" names

Confirmed live version is `v02.0037`. This spec targets `v02.0038`.

## Before you build this — the table you're picturing already exists

Grounded this against the live `matchMemberCore.ts`, `matchMember.ts`, and
`app/api/users/merge/route.ts` before writing anything, because the request as described
("we must add a table — old name and merged-into name") is actually already built:

`Member.aliases` (a comma-separated string column, already on the schema) **is** that table.
Every merge already writes the merged-away member's name into the kept member's `aliases`
(`app/api/users/merge/route.ts`, the `aliases` `Set` built right before the transaction), and
every Rename already does the same for the old spelling. And `matchMemberCore.ts`'s
`findMemberId()` — the function every screenshot import calls to match an extracted name to a
real member — already checks a raw name against **both** `member.name` and `member.aliases`,
exact match first, then a length-proportional fuzzy (Levenshtein) fallback.

So this isn't "add the table," it's "the table exists and is being checked, but these
specific ultra-garbled names still don't land inside the fuzzy-match tolerance often enough."
That's a real, fixable gap — three changes below, all in the matching logic and the two
admin screens that already deal with this (Users, Merge), no schema change:

1. **Aliases get a looser match tolerance than the canonical name.** Right now every
   candidate (name and every alias) is judged by the same 20%-of-length rule. An alias isn't
   a guess, though — a human already confirmed it refers to this exact person (via Merge or
   Rename). A new OCR reading landing reasonably close to an *already-confirmed* variant is
   much safer to trust than one landing close to a name nobody's ever specifically compared it
   against. Loosening tolerance for alias comparisons only (not the canonical name) targets
   exactly the "keeps generating new ghosts of the same real person" case without reopening
   the "minktest vs Inktest" over-merge risk that was fixed for canonical names specifically.
2. **Every accepted match — not just explicit merges — grows the alias list.** Today
   `aliases` only grows from a human clicking Merge or Rename. If the pipeline's own fuzzy
   match silently accepts a near-miss OCR reading, that specific string is never remembered,
   so the *next* slightly-different reading has to survive the fuzzy check all over again from
   scratch. Recording every newly-seen matched spelling as an alias means the known-variant
   list for a volatile name keeps growing on its own, compounding with change 1 above over
   time.
3. **A safety net for whatever still slips through.** No threshold change eliminates every
   miss for a name that reads differently enough each time — that's a Gemini OCR limit on
   these specific glyphs, not something tunable away entirely (same conclusion as the earlier
   name-recognition work). So Setup → Users now shows a "looks like an existing member?"
   hint next to any new unconfirmed member, with a one-click link straight into Merge,
   prefilled — turning "hunt through the member list to find the duplicate" into one click.

## Change 1 — `lib/pipeline/matchMemberCore.ts`: looser tolerance for alias matches

```ts
const NAME_MATCH_THRESHOLD_RATIO = 0.2;
// Aliases are already confirmed variants of a real person's name (recorded by an explicit
// merge or rename - see app/api/users/merge/route.ts and the rename handler in
// app/api/users/[id]/route.ts), not a guess the way a bare name comparison is. A new OCR
// reading landing close to an already-confirmed variant is very likely more of the same
// noise for that same person, so aliases get a looser tolerance than the canonical name -
// this is the main lever for garbled/mixed-script names that read a little differently on
// every import. MIN_LENGTH_FOR_FUZZY_MATCH below still requires an exact hit for very short
// names regardless of which list matched, so this doesn't reopen the short-name over-merge
// risk that was fixed separately.
const ALIAS_MATCH_THRESHOLD_RATIO = 0.35;
const MIN_LENGTH_FOR_FUZZY_MATCH = 8;
```

Replace the body of `findMemberId()` (keep its signature and exported type exactly as-is —
every existing caller keeps working unchanged, this only makes matches succeed in more cases
than before, never fewer):

```ts
export function findMemberId(rawName: string, members: MatchableMember[]): number | null {
  const trimmedName = stripAllianceTag(rawName);
  const normalized = normalize(trimmedName);
  const normalizedLength = Array.from(normalized).length;

  let best: { id: number; distance: number; ratio: number } | null = null;
  for (const member of members) {
    const candidates: [string, number][] = [
      [member.name, NAME_MATCH_THRESHOLD_RATIO],
      ...member.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean)
        .map((a): [string, number] => [a, ALIAS_MATCH_THRESHOLD_RATIO]),
    ];

    for (const [candidate, ratio] of candidates) {
      const normalizedCandidate = normalize(candidate);
      if (!normalizedCandidate) continue;
      if (normalizedCandidate === normalized) {
        return member.id;
      }
      const distance = levenshtein(normalized, normalizedCandidate);
      if (!best || distance < best.distance) {
        best = { id: member.id, distance, ratio };
      }
    }
  }

  if (!best) return null;
  const threshold =
    normalizedLength >= MIN_LENGTH_FOR_FUZZY_MATCH ? Math.max(1, Math.round(normalizedLength * best.ratio)) : 0;
  return best.distance <= threshold ? best.id : null;
}
```

The only behavioral change: which ratio applies is now decided by *where the closest
candidate came from* (a member's canonical name vs. one of their aliases), instead of always
using the same 20% for everything. `0.35` is a starting point, not something derived from a
measured sample of these names — if it's still not catching real cases after this ships,
that's a one-line number to nudge, not a redesign.

## Change 2 — `lib/pipeline/matchMember.ts`: record every newly-seen matched spelling

```ts
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { findMemberId, stripAllianceTag, normalize, type MatchableMember } from "./matchMemberCore";

export async function matchMember(rawName: string, allianceTag: string = "RUNE"): Promise<number> {
  const members = await prisma.member.findMany();
  const matched = findMemberId(rawName, members);
  if (matched !== null) {
    await recordAliasIfNew(matched, rawName, members);
    return matched;
  }

  const name = stripAllianceTag(rawName);
  try {
    const created = await prisma.member.create({ data: { name, nameConfirmed: false } });
    return created.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.member.findUnique({ where: { name } });
      if (existing) return existing.id;
    }
    throw new Error(`Failed to match or create member "${name}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

// After a successful match (exact or fuzzy), remembers this exact raw spelling as a new
// alias if it isn't already known verbatim for this member - this is what makes the "known
// variants" list for a volatile/garbled name keep growing on its own, not just from an
// explicit Merge or Rename. Combined with the looser alias tolerance above, each newly
// confirmed variant becomes a stepping stone for catching the next slightly-different one,
// without ever touching a DIFFERENT member's data (this only ever writes to the member
// findMemberId already decided this name belongs to).
async function recordAliasIfNew(memberId: number, rawName: string, members: MatchableMember[]): Promise<void> {
  const member = members.find((m) => m.id === memberId);
  if (!member) return;

  const cleanName = stripAllianceTag(rawName);
  const normalized = normalize(cleanName);
  const known = [member.name, ...member.aliases.split(",").map((a) => a.trim())].filter(Boolean);
  if (known.some((k) => normalize(k) === normalized)) return; // already known verbatim

  const aliases = new Set(member.aliases.split(",").map((a) => a.trim()).filter(Boolean));
  aliases.add(cleanName);
  await prisma.member.update({ where: { id: memberId }, data: { aliases: [...aliases].join(", ") } });
}
```

`normalize` and `MatchableMember` need adding to the import line from `./matchMemberCore` -
both already exported there, just not previously imported here. One accepted tradeoff: a
member whose name reads very inconsistently will accumulate a genuinely long `aliases` string
over time (every distinct OCR variant ever confirmed for them). That's harmless — it's a
single text column, and this alliance's roster size means lookups stay fast regardless — but
worth knowing about if `aliases` ever looks unexpectedly long for someone on Setup → Users.

## Change 3 — Setup → Users: "looks like an existing member?" suggestion

### `lib/pipeline/matchMemberCore.ts` — add `bestMatchExcluding()`

Add alongside `findMemberId()`:

```ts
export type MatchCandidate = { id: number; name: string; distance: number; similarity: number };

/**
 * Best fuzzy match for `name` among `members`, excluding `excludeId` (the member being
 * evaluated itself). Unlike findMemberId, this always returns the closest candidate
 * regardless of any auto-match threshold, with a similarity score (0-1) the caller decides
 * what to do with. Used to surface "this new unconfirmed member looks like an existing one"
 * hints on Setup → Users - a garbled name can land close enough to be worth a human glance
 * without ever being close enough to safely auto-match.
 */
export function bestMatchExcluding(name: string, excludeId: number, members: MatchableMember[]): MatchCandidate | null {
  const normalized = normalize(stripAllianceTag(name));
  if (!normalized) return null;

  let best: MatchCandidate | null = null;
  for (const member of members) {
    if (member.id === excludeId) continue;
    const candidates = [member.name, ...member.aliases.split(",").map((a) => a.trim())].filter(Boolean);
    for (const candidate of candidates) {
      const normalizedCandidate = normalize(candidate);
      if (!normalizedCandidate) continue;
      const distance = levenshtein(normalized, normalizedCandidate);
      const longer = Math.max(normalized.length, normalizedCandidate.length, 1);
      const similarity = 1 - distance / longer;
      if (!best || similarity > best.similarity) {
        best = { id: member.id, name: member.name, distance, similarity };
      }
    }
  }
  return best;
}
```

### `app/api/users/route.ts` — attach a suggestion to each unconfirmed member

```ts
import { bestMatchExcluding } from "@/lib/pipeline/matchMemberCore";

const SUGGESTION_SIMILARITY_FLOOR = 0.6; // below this, not worth surfacing - too likely noise
```

Inside the `users: members.map((m) => { ... })` block, compute this once per member and add
it to the returned object:

```ts
      const suggestedMerge = !m.nameConfirmed ? suggestClosestMatch(m, members) : null;
      return {
        id: m.id,
        name: m.name,
        allianceRank: m.allianceRank,
        roleOverride: m.role,
        effectiveRole: role,
        hasPassword,
        canLogIn: hasPassword || (role !== "ADMIN" && generalPasswordSet),
        isActive: m.isActive,
        nameConfirmed: m.nameConfirmed,
        loginAlias: m.loginAlias,
        recentlyActive: recentlyActiveIds.has(m.id),
        everHadCompletedWeek: everHadCompletedWeekIds.has(m.id),
        suggestedMerge,
      };
```

Add the small helper below the `GET` function:

```ts
function suggestClosestMatch(
  member: { id: number; name: string },
  members: { id: number; name: string; aliases: string }[]
): { id: number; name: string; similarity: number } | null {
  const match = bestMatchExcluding(member.name, member.id, members);
  if (!match || match.similarity < SUGGESTION_SIMILARITY_FLOOR) return null;
  return { id: match.id, name: match.name, similarity: Math.round(match.similarity * 100) };
}
```

### `app/setup/users/list/UsersClient.tsx` — show the hint

Add to the `User` type:

```ts
  suggestedMerge: { id: number; name: string; similarity: number } | null;
```

Add the link right after the existing "New"/Confirm/Reject block (still inside the
`{!u.nameConfirmed && (...)}` group, so it never shows for an already-confirmed member):

```tsx
                        {u.suggestedMerge && (
                          <Link
                            href={`/setup/users/merge?keep=${u.suggestedMerge.id}&merge=${u.id}`}
                            className="ml-2 text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                            title={`${u.suggestedMerge.similarity}% similar`}
                          >
                            Looks like &quot;{u.suggestedMerge.name}&quot;? Merge →
                          </Link>
                        )}
```

### `app/setup/users/merge/MergeClient.tsx` — accept `?keep=`/`?merge=` to prefill

```ts
import { useSearchParams } from "next/navigation";
```

```ts
  const searchParams = useSearchParams();
```

Add a second effect after the existing `load()`-on-mount effect, so it runs once the roster
is actually available to validate against:

```ts
  useEffect(() => {
    if (users.length === 0) return;
    const keepParam = Number(searchParams.get("keep"));
    const mergeParam = Number(searchParams.get("merge"));
    if (Number.isInteger(keepParam) && users.some((u) => u.id === keepParam)) setKeepId(keepParam);
    if (Number.isInteger(mergeParam) && users.some((u) => u.id === mergeParam)) setMergeId(mergeParam);
  }, [users, searchParams]);
```

### `app/setup/users/merge/page.tsx` — wrap in `Suspense`

`useSearchParams()` in a client component needs a `Suspense` boundary above it in the App
Router (this page didn't need one before since nothing here read search params):

```tsx
import { Suspense } from "react";
import { requireMenuAccess } from "@/lib/menuAccess";
import { MergeClient } from "./MergeClient";

export default async function MergePage() {
  await requireMenuAccess("users-merge");
  return (
    <Suspense fallback={<p className="text-neutral-500 text-sm">Loading…</p>}>
      <MergeClient />
    </Suspense>
  );
}
```

If the build already succeeds without this (Next 16 may have relaxed the requirement, or this
route may already be forced dynamic by the auth check), it's a harmless no-op either way - not
worth debugging further either direction, just include it.

## Bump the version

`lib/version.ts`:

```ts
const MINOR = 38;
```

## Test

1. Deploy, confirm the header version reads `02.0038`.
2. Pick a member you've had to merge more than once because of a garbled name. Check their
   `aliases` value directly (Neon SQL editor: `SELECT name, aliases FROM "Member" WHERE id = <id>;`)
   - confirm it already has at least one entry from the earlier merge(s).
3. Re-upload (or wait for) a screenshot with a slightly different OCR reading of that same
   name. Confirm it now matches the existing member instead of creating a new "New" row - and
   confirm (same SQL query) that this new spelling got appended to `aliases` too.
4. Deliberately test a case that should still fail to auto-match: two genuinely different
   short (<8 normalized characters) real members with similar names - confirm they still don't
   get combined (this is the protection Change 1 deliberately didn't touch).
5. Upload a screenshot for a name that's different enough to still create a new "New" member.
   Open Setup → Users, confirm the "Looks like ...? Merge →" hint shows when a plausible
   existing member exists, and confirm it's absent when nothing is close enough (60%+
   similarity floor).
6. Click the hint - confirm it lands on Merge with both dropdowns already correctly filled in,
   and that a normal (non-prefilled) visit to Merge still works exactly as before.

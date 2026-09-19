# Fix: new members locked out of login entirely, and a 2-week grace period before Inactive

For the Claude Code session on Frans's machine.

**Correction from the first version of this spec**: I originally called the
"No access" label a cosmetic reporting gap - general password working fine
underneath, just not shown. Frans reported a real counter-example: a member
new this week couldn't sign in with the general password at all, and only
setting that same string as their *individual* password fixed it. That's
not possible if the label were the only problem, so I went back through
`lib/members/activeSync.ts` line by line and found the actual mechanism
below - it's Part 2, not Part 1, and it's worse than "no grace period": as
deployed today it can lock a brand-new member out of login completely,
general password included, the very first time an admin opens Setup →
Users after they're created. Part 1 (the label fix) is still correct and
worth doing, but Part 2 is the one that explains what Frans actually saw.

## Part 1: "No access" for almost everybody

### What I found reading the actual code

Role assignment already is automatic and needs no change: `effectiveRole()`
(`lib/auth/roles.ts`) derives `LEADER`/`MEMBER` straight from `allianceRank`
(R4/R5 → Leader, else Member) with zero admin action, for every member,
new or old. That part of the ask is already true today.

Login access is where the real gap is - but it's not that new members
can't get access, it's that the Users screen's "No access" label doesn't
tell you the truth about who can actually log in. `app/login/actions.ts`
already has a fallback built in:

```ts
// lib/auth/session.ts's checkPassword(), called from login/actions.ts
async function checkPassword(member: Member, password: string): Promise<boolean> {
  if (member.passwordHash) return verifyPassword(password, member.passwordHash);
  if (effectiveRole(member) === "ADMIN") return false;
  const generalPassword = await getGeneralPassword();
  return !!generalPassword && password === generalPassword;
}
```

So any member without their own password can already log in with the
**general password** (Setup → Settings → "General password") - except
Admins, who always need their own. That setting already exists and is
fully wired up. But `GET /api/users` only ever reports `hasPassword: !!
m.passwordHash` - it has no idea the general-password fallback exists - so
`UsersClient.tsx`'s Login column shows "No access" for every member who
doesn't have an *individually* assigned password, even when they can
already log in perfectly fine with the shared one. That's almost certainly
what you're seeing: not that access is actually broken for everyone, but
that the label only ever reflects one of the two working paths.

The one way this label would be telling the truth is if no general
password has been set at all - in which case it really is "no access" for
anyone without an individual password, and that's a one-field fix in
Setup → Settings, not a code change. Either way, the fix below makes the
Users screen tell you which situation you're actually in.

### Fix — `app/api/users/route.ts`

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { effectiveRole } from "@/lib/auth/roles";
import { getGeneralPassword } from "@/lib/settings";
import { syncMemberActiveStatus } from "@/lib/members/activeSync";

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { lastCompletedWeek } = await syncMemberActiveStatus();
  const generalPasswordSet = !!(await getGeneralPassword());
  const members = await prisma.member.findMany({ orderBy: { name: "asc" } });

  return NextResponse.json({
    lastCompletedWeek,
    generalPasswordSet,
    users: members.map((m) => {
      const role = effectiveRole(m);
      const hasPassword = !!m.passwordHash;
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
      };
    }),
  });
}
```

(`requireAdminApi` import stays at the top, unchanged. If `recentlyActive`/
`loginAlias`/`everHadCompletedWeek` from earlier specs have already landed
on this file, add `canLogIn`/`generalPasswordSet` alongside them rather
than reverting those - all of these are independent added fields on the
same response.)

### Fix — `app/setup/users/list/UsersClient.tsx`

Add `import Link from "next/link";` at the top, add `canLogIn: boolean` to
the `User` type and a `generalPasswordSet` state:

```ts
const [generalPasswordSet, setGeneralPasswordSet] = useState(true);
```

In `load()`, capture it from the response:

```ts
setGeneralPasswordSet(data.generalPasswordSet ?? true);
```

(`true` as the fallback default is deliberate - don't show a scary "no
general password" banner while the page is still loading its first
response.)

Add a banner right after the intro paragraph, before the search input:

```tsx
{!generalPasswordSet && (
  <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 text-sm">
    No general password is set - members without their own password can&apos;t log in at all yet
    (their role is already auto-assigned from Alliance Rank, only login access is missing). Set one
    in <Link href="/settings" className="underline">Setup → Settings</Link> to give every member,
    new or existing, automatic access without setting individual passwords one by one.
  </p>
)}
```

Replace the Login column's badge (currently just `u.hasPassword ? "Has
password" : "No access"`) so it reflects reality:

```tsx
<span
  className={
    u.hasPassword
      ? "text-green-700 text-xs"
      : u.canLogIn
        ? "text-blue-700 text-xs"
        : "text-neutral-400 text-xs"
  }
>
  {u.hasPassword ? "Has password" : u.canLogIn ? "Uses general password" : "No access"}
</span>
```

No other lines in this file need to change for this part - the password-
draft input/Set button next to it stay exactly as-is, for setting an
individual password when you want to override the shared one for someone
specific (e.g. before promoting them to Admin, which always needs one).

## Part 2: new members get locked out of login entirely

### What's actually there today - the real bug

`app/login/actions.ts` gates login on `isActive` before it even looks at
the password:

```ts
const valid = !!member && member.isActive && (await checkPassword(member, password));
```

`isActive` is `true` by default on a brand-new `Member` row (`lib/pipeline/
matchMember.ts`'s auto-create sets nothing else, so it's whatever
`prisma/schema.prisma` defaults it to). So far so good - a new member
should be able to log in immediately. But `lib/members/activeSync.ts`'s
`syncMemberActiveStatus()` runs on *every single load* of Setup → Users
(it's called from `GET /api/users`), and as deployed today it checks only
one week - the last *completed* week - and flips anyone with zero data in
that one week to `isActive: false`, with no exemption for someone who
simply hasn't had the chance to appear in a completed week yet:

```ts
const activeIds = await getActiveMemberIdsForWeek(lastCompletedWeek);
// ...
for (const m of members) {
  if (effectiveRole(m) !== "MEMBER") continue;
  const shouldBeActive = activeIds.has(m.id);          // false for a member who joined this week
  if (m.isActive === shouldBeActive) continue;
  (shouldBeActive ? toActivate : toDeactivate).push(m.id);   // -> toDeactivate
}
```

So the very first time you open Setup → Users after a new member's row is
created - before their first completed week has rolled over - this
function flips them to `isActive: false`. And because `isActive` gates
login *before* the password check ever runs, that locks them out
completely: general password, individual password, doesn't matter, both
fail identically. That's exactly what you saw - "couldn't sign in with the
general password" wasn't the general-password mechanism failing, it was
`isActive` blocking the whole login attempt before any password was even
compared. Setting an individual password didn't fix that by itself; you
almost certainly also flipped their Active toggle back on at the same time
on that screen and attributed the fix to the password. This is also the
same root mechanism as the "confirmed but still greyed out" bug from the
earlier `users-and-merge-fixes-spec.md` (Part 4, "New" badge) - that spec
only fixed how it *displays*; it never touched the fact that this same
flag also silently kills login. And since one missed week (a real player
just skipping a screenshot) triggers the exact same lockout, this is very
plausibly also why the Users screen currently reads as "no access for
almost everybody" - it's not that access is broken across the board, it's
that this function is aggressively (and silently) revoking it every time
you open the page.

### Fix

Two changes, both in how `syncMemberActiveStatus()` decides who to
deactivate: (1) require **2 consecutive completed weeks** with no data
before flipping someone existing to Inactive, matching what you asked for,
and (2) never evaluate - and therefore never deactivate - a member who has
never had a single completed week of data yet. That second part is the one
that actually fixes the new-member lockout: a fresh row's `isActive`
defaults to `true` and now just stays untouched until they've had a fair
chance to show up in at least one completed week.

Add a new helper to `lib/members/weekActivity.ts` (alongside the existing
two functions, unchanged):

```ts
/**
 * Members with at least one WeeklyStat or CategoryRecord row at or before this week - i.e.
 * "has ever had a completed week's worth of data, as of week N." Lets active-status syncing
 * tell a genuinely brand-new member (who hasn't had the chance to appear in a completed week
 * yet) apart from a returning member with an actual gap - see activeSync.ts.
 */
export async function getMemberIdsWithHistoryThroughWeek(weekNumber: number): Promise<Set<number>> {
  const [statMembers, recordMembers] = await Promise.all([
    prisma.weeklyStat.findMany({ where: { weekNumber: { lte: weekNumber } }, select: { memberId: true }, distinct: ["memberId"] }),
    prisma.categoryRecord.findMany({ where: { weekNumber: { lte: weekNumber } }, select: { memberId: true }, distinct: ["memberId"] }),
  ]);
  return new Set([...statMembers.map((s) => s.memberId), ...recordMembers.map((r) => r.memberId)]);
}
```

Then rewrite `lib/members/activeSync.ts` in full:

```ts
import { prisma } from "@/lib/db";
import { effectiveRole } from "@/lib/auth/roles";
import { getActiveMemberIdsForWeek, getMemberIdsWithHistoryThroughWeek } from "./weekActivity";

// A member only flips to Inactive after missing data in ALL of the last INACTIVE_GRACE_WEEKS
// completed weeks - one missed screenshot shouldn't read the same as "this person left."
const INACTIVE_GRACE_WEEKS = 2;

export async function syncMemberActiveStatus(): Promise<{ lastCompletedWeek: number | null }> {
  const latest = await prisma.weeklyStat.findFirst({ orderBy: { weekNumber: "desc" }, select: { weekNumber: true } });
  if (!latest) return { lastCompletedWeek: null };

  const lastCompletedWeek = latest.weekNumber - 1;
  if (lastCompletedWeek < 1) return { lastCompletedWeek };

  const weeksToCheck = Array.from({ length: INACTIVE_GRACE_WEEKS }, (_, i) => lastCompletedWeek - i).filter((w) => w >= 1);
  const weekSets = await Promise.all(weeksToCheck.map((w) => getActiveMemberIdsForWeek(w)));
  const activeIds = new Set(weekSets.flatMap((s) => [...s]));

  // Anyone who has never had a single completed week of data yet is too new to judge - leave
  // them exactly as they are. A fresh Member row defaults to isActive: true, so this is what
  // actually grants a brand-new member working login access from day one (general password
  // included) instead of getting silently locked out the next time this page loads.
  const everHadHistory = await getMemberIdsWithHistoryThroughWeek(lastCompletedWeek);

  const members = await prisma.member.findMany({
    select: { id: true, role: true, allianceRank: true, isActive: true },
  });

  const toActivate: number[] = [];
  const toDeactivate: number[] = [];
  for (const m of members) {
    if (effectiveRole(m) !== "MEMBER") continue;
    if (!everHadHistory.has(m.id)) continue;
    const shouldBeActive = activeIds.has(m.id);
    if (m.isActive === shouldBeActive) continue;
    (shouldBeActive ? toActivate : toDeactivate).push(m.id);
  }

  await Promise.all([
    toActivate.length > 0 ? prisma.member.updateMany({ where: { id: { in: toActivate } }, data: { isActive: true } }) : null,
    toDeactivate.length > 0 ? prisma.member.updateMany({ where: { id: { in: toDeactivate } }, data: { isActive: false } }) : null,
  ]);

  return { lastCompletedWeek };
}
```

Two behavior changes from what's live today: someone with history now
stays `isActive: true` as long as they had data in *any* of the last two
completed weeks, only flipping to `false` once both are empty; and someone
with **no** completed-week history at all is never touched by this
function - they simply keep whatever `isActive` already is (`true` for a
freshly created row), until they've had their first completed week to
actually be judged on.

If the earlier `users-and-merge-fixes-spec.md`'s Part 4
(`everHadCompletedWeek` on `GET /api/users`, for the "New" vs "Inactive"
badge) lands in the same implementation pass as this, have it call this
same `getMemberIdsWithHistoryThroughWeek()` helper instead of writing a
second, separate query for the same thing - it's exactly the same set.

Worth knowing: the Users screen row dimming and any other reader of
`isActive` keep working unchanged - they just read whatever `isActive`
currently says, and now that value is trustworthy for a brand-new member
instead of flipping false before they've had a chance.

## Bump the version number

`lib/version.ts` — increment `MINOR` by 1 from whatever it currently is at
implementation time.

## Test plan

1. Check Setup → Settings for whether a general password is actually set.
   If not, that banner should now appear on Setup → Users.
2. With a general password set, confirm members without an individual
   password now show "Uses general password" instead of "No access", and
   that logging in as one of them with the general password actually works
   (already-existing behavior, just newly visible).
3. **The case that matters**: upload a screenshot with a brand-new name so
   the pipeline auto-creates a fresh `Member` row, then load Setup → Users
   (triggering `syncMemberActiveStatus()`) before that member has any
   completed-week data. Confirm they still show Active/"New" and can
   actually log in with the general password - this is the scenario that
   was silently broken before this fix.
4. Find (or simulate) an existing member with data in week N-2 but not week
   N-1 (one missed week, most recent). Confirm they still show Active and
   can still log in. Only once they're missing from both of the last two
   completed weeks should they flip to Inactive.

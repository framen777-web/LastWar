# Conductor Selection — stale duplicate/collision warning fix

## Bug (as reported)

On `/conductor/select`, when two slots are flagged because the same member
is picked twice in the round, changing one of those two slots to a
different member correctly clears the warning on the slot you just edited —
but the *other* slot (its former duplicate partner) keeps showing the
warning, even though the duplicate no longer exists. It only clears once
that other slot is itself edited (or the page is fully reloaded).

## Root cause (confirmed against the live code)

There are two separate warning mechanisms on this page, and only one of
them is actually broken:

1. **The red "duplicate member" ring/label** (`isDuplicate` in
   `SelectClient.tsx`) — computed fresh on every render from the *entire*
   `slots` array (`memberCounts`/`duplicateMemberIds` in
   `CombinedSlotTable`, around line 284). This one is fine as-is: as long
   as `slots` state itself is accurate, this always recomputes correctly
   for every row on every render.

2. **The amber "collision" banner + reason text** (`slot.collision` /
   `slot.collisionReason`, e.g. "Also Passenger on Wednesday.",
   "Same member is Conductor and Passenger this day.") — this is the one
   that goes stale, and it's a **server-computed value returned only for
   the one slot that was just patched.**

`lib/conductor/selection.ts`'s `overrideSlot()` (lines 375-478) and
`rerollPassengerSlot()` (lines 480-539) each update exactly one
`ConductorSelection` row, then compute `collision`/`collisionReason` for
*that single updated row only* (`overrideSlot`, lines 452-459) and return
just that one `DraftSlot` (`{ ok: true; slot: DraftSlot }`).

`app/conductor/select/SelectClient.tsx`'s `applyPatchedSlot()` (line 98)
then splices that one returned slot into client state and leaves every
other slot object completely untouched:

```tsx
function applyPatchedSlot(slot: DraftSlot) {
  setSlots((prev) => prev.map((s) => (s.slotIndex === slot.slotIndex && s.role === slot.role ? slot : s)));
}
```

So: slot A and slot B are both flagged `collision: true` ("Also Passenger
on ...") because they share a member. You edit slot A to a different
member. The server correctly recomputes slot A's own collision as `false`
and returns it. The client replaces slot A in state. Slot B's `DraftSlot`
object — still holding `collision: true` from whenever it was last
fetched — is never touched, because the server was never asked to look at
it and the client only ever patches the one slot it got back. Slot B's
stale amber banner stays until slot B itself is edited (which forces the
server to recompute *its* collision) or the page does a full refetch
(`getRoundSlots()`, which *does* recompute collision for every slot,
lines 335-372).

This matches the reported symptom exactly: "the check is resolved on that
line, but the other line ... still shows [it], the refresh [is] done for
that line, but the duplicate check must be redone for the whole page."

## Fix

Recompute collision for **every slot in the round**, as part of the same
request that made the edit — not a second round-trip (the existing code
comment in `applyPatchedSlot`/`submitSlotPatch` explains why a follow-up
GET was deliberately avoided: a slower GET landing after the PATCH could
revert the edit visually with a stale snapshot). Since `overrideSlot()`
and `rerollPassengerSlot()` already load the round's full `selections`
list from the DB before touching anything, recomputing collision for the
whole list is free — it's the same data already in memory, just also
applying `detectRoundCollision()` to the rows besides the one that
changed.

### 1. `lib/conductor/selection.ts`

Extract the per-selection → `DraftSlot` + collision mapping that
`getRoundSlots()` already does (lines 344-369) into a shared helper, then
reuse it from `overrideSlot()` and `rerollPassengerSlot()` too.

**Add this new function**, right after `unresolvedReason()` (after line
128, before `loadContext()`):

```ts
/**
 * Builds the full DraftSlot list for a set of selections, with collision
 * recomputed against every other selection in the same set - shared by
 * getRoundSlots() (full round fetch) and by overrideSlot()/
 * rerollPassengerSlot() (a single-slot edit) so an edit that resolves or
 * creates a collision is reflected on every affected slot immediately,
 * not just the one that was actually changed.
 */
function buildDraftSlots(
  selections: {
    slotIndex: number;
    weekNumber: number;
    role: string;
    memberId: number | null;
    pointsAtSelection: number | null;
    sourceCategoryKey: string | null;
    sourceRank: number | null;
    manualOverride: boolean;
  }[],
  memberNameById: Map<number, string>,
  allowDuplicatePassengers: boolean
): DraftSlot[] {
  return selections
    .map((s) => {
      const { collision, collisionReason } =
        s.memberId === null
          ? { collision: true, collisionReason: unresolvedReason(s.role as "conductor" | "passenger", s.sourceCategoryKey, s.sourceRank) }
          : detectRoundCollision(
              { slotIndex: s.slotIndex, role: s.role as "conductor" | "passenger", memberId: s.memberId },
              selections,
              allowDuplicatePassengers
            );
      return {
        slotIndex: s.slotIndex,
        weekday: weekdayForSlot(s.slotIndex),
        weekNumber: s.weekNumber,
        role: s.role as "conductor" | "passenger",
        memberId: s.memberId,
        memberName: s.memberId !== null ? (memberNameById.get(s.memberId) ?? null) : null,
        pointsAtSelection: s.pointsAtSelection,
        sourceCategoryKey: s.sourceCategoryKey,
        sourceRank: s.sourceRank,
        manualOverride: s.manualOverride,
        collision,
        collisionReason,
      };
    })
    .sort((a, b) => a.slotIndex - b.slotIndex || a.role.localeCompare(b.role));
}
```

**Simplify `getRoundSlots()`** (lines 335-372) to use it — replace the
`const slots: DraftSlot[] = round.selections.map(...)...sort(...)` block
(lines 344-369) with:

```ts
  const slots = buildDraftSlots(round.selections, memberNameById, settings.allowDuplicatePassengers);
```

**Change `overrideSlot()`'s return type and tail** (lines 375-478).
Change the signature's return type from:

```ts
): Promise<{ ok: true; slot: DraftSlot } | { ok: false; error: string }> {
```

to:

```ts
): Promise<{ ok: true; slots: DraftSlot[] } | { ok: false; error: string }> {
```

Then replace everything from `const otherSelections = ...` (line 451)
through the end of the function (line 478) with:

```ts
  const otherSelections = round.selections.map((s) => (s.id === updated.id ? updated : s));
  const slots = buildDraftSlots(otherSelections, memberNameById, settings.allowDuplicatePassengers);

  return { ok: true, slots };
```

This drops the single-slot `detectRoundCollision`/return block (old lines
452-477) entirely — `buildDraftSlots()` now does that for every slot in
one pass.

**Change `rerollPassengerSlot()`'s return type and tail** (lines
480-539) the same way. Change the signature's return type from:

```ts
): Promise<{ ok: true; slot: DraftSlot } | { ok: false; error: string }> {
```

to:

```ts
): Promise<{ ok: true; slots: DraftSlot[] } | { ok: false; error: string }> {
```

Then replace the `return { ok: true, slot: { ... } };` block (lines
522-538) with:

```ts
  const otherSelections = round.selections.map((s) => (s.id === updated.id ? updated : s));
  const slots = buildDraftSlots(otherSelections, memberNameById, settings.allowDuplicatePassengers);

  return { ok: true, slots };
```

(`settings` and `memberNameById` are already in scope earlier in this
function.)

Side benefit worth knowing about, not something extra being built: today
`rerollPassengerSlot()`'s own returned slot only ever sets
`collision: updated.memberId === null` — it never actually checks whether
the freshly-rerolled member collides with the day's Conductor or another
Passenger (unlike `overrideSlot()`, which does run `detectRoundCollision`).
Routing it through `buildDraftSlots()` fixes that for free, as a
consequence of this change rather than separate scope.

### 2. `app/api/conductor/rounds/[id]/slots/route.ts`

Both success responses currently return `{ slot: result.slot }`. Change
both to `{ slots: result.slots }`:

```ts
  if (body.role === "passenger" && body.reroll === true) {
    const result = await rerollPassengerSlot(Number(id), body.slotIndex);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ slots: result.slots });
  }
```

and, at the end of the handler:

```ts
  const result = await overrideSlot(Number(id), body.slotIndex, body.role, {
    memberId: body.memberId,
    sourceRank: body.sourceRank,
    sourceCategoryKey: body.sourceCategoryKey,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ slots: result.slots });
```

No other route calls `overrideSlot()`/`rerollPassengerSlot()` — this is
the only call site for both.

### 3. `app/conductor/select/SelectClient.tsx`

Replace `applyPatchedSlot()` (lines 94-100) with a whole-array setter:

```tsx
  // Every PATCH now recomputes and returns the full round's slots (collision included) in one
  // response, not just the one slot that was edited - so a duplicate/collision flag on another
  // slot clears (or appears) immediately, without a second round-trip whose own GET could land
  // a slightly older snapshot after the PATCH's and visually revert the edit just made.
  function applyRefreshedSlots(newSlots: DraftSlot[]) {
    setSlots(newSlots);
  }
```

Then in `submitSlotPatch()` (lines 102-118), change:

```tsx
    } else if (data.slot) {
      applyPatchedSlot(data.slot);
    }
```

to:

```tsx
    } else if (data.slots) {
      applyRefreshedSlots(data.slots);
    }
```

No other change needed in this file — `CombinedSlotTable`'s
`duplicateMemberIds` computation and every render already derive purely
from the `slots` state array, so once that array is fully refreshed after
every edit, both warning mechanisms (the red duplicate ring and the amber
collision banner) stay in sync across the whole page automatically.

### 4. Version bump

`lib/version.ts` is currently `MAJOR = 2; MINOR = 43;` (`v02.0043`). Bump
to `MINOR = 44` as part of this change.

## Test plan

1. Generate (or open an existing draft) round with at least 2 weeks so
   there are multiple Passenger slots to force a collision.
2. Manually override two different slots (e.g. two different days'
   Passenger, or a Passenger and that day's Conductor) to the same
   member. Confirm both slots show the amber "Also Passenger on ..." /
   "Same member is Conductor and Passenger this day." banner, and both
   show the red duplicate ring.
3. Edit *one* of the two slots to a different, non-conflicting member.
   Confirm: that slot's amber banner and red ring both clear immediately
   — and, without touching it, the *other* (previously duplicate) slot's
   amber banner and red ring also clear immediately, in the same
   response.
4. Create a fresh collision by editing an unrelated slot to a member
   already used elsewhere in the round. Confirm the new collision shows
   up on both the slot you just edited and the pre-existing slot it now
   conflicts with, without a page reload.
5. Reroll a Random passenger slot into a member who now collides with
   someone else in the round (may take a couple of rerolls to land on
   one). Confirm the collision banner appears on both the rerolled slot
   and its new duplicate partner.
6. Reload the page (full `getRoundSlots()` fetch) after step 3 or 4 and
   confirm the displayed state matches what was already shown — i.e. the
   full-refetch path and the per-edit path agree.

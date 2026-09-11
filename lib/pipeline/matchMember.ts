import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { findMemberId, stripAllianceTag, normalize, type MatchableMember } from "./matchMemberCore";

/**
 * Fuzzy-matches a raw OCR'd member name against the known roster (name + aliases).
 * Creates a new Member row if nothing matches closely enough.
 *
 * `allianceTag` is accepted but unused here - name matching itself never needed it (findMemberId/
 * stripAllianceTag just clean up whatever raw name string arrives). It's kept as a parameter only
 * so callers that decide "is this row a current member at all" *before* calling matchMember (see
 * runSeasonExtra.ts's hasAllianceTag check against the AI's separately-reported alliance_tag
 * field) can keep passing it through without every call site needing to change shape.
 */
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
    // Two confirms/uploads racing on the same brand-new name (e.g. confirming several
    // pending Review batches back to back) can both pass the findMany() check above
    // before either has created the row, so the second create() hits the unique
    // constraint - look up who won instead of failing the whole confirm.
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

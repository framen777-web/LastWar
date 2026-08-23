import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { findMemberId, stripAllianceTag } from "./matchMemberCore";

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
  if (matched !== null) return matched;

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

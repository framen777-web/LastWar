import { prisma } from "@/lib/db";
import { matchMember } from "./matchMember";
import { stripAllianceTag } from "./matchMemberCore";

/**
 * Resolves a raw CSV name to a member ID for import commit. If the admin flagged this
 * name (during preview) as "this is an existing member's new name" rather than "new
 * member", renames that existing member in place instead of creating a duplicate - since
 * it's the same Member.id throughout, every existing WeeklyStat/CategoryRecord/
 * ConductorSelection/Suggestion row is already correctly attached, no data migration
 * needed. The old name is preserved as an alias so older files with the old name still
 * fuzzy-match this member in future imports.
 */
export async function resolveOrRenameMember(rawName: string, resolutions: Record<string, number | null>): Promise<number> {
  const newName = stripAllianceTag(rawName);
  // Preview lists unmatched names stripped of any alliance tag (see the "new members"
  // list built during preview) - resolutions are keyed the same way the client saw them.
  const resolvedId = resolutions[newName];
  if (resolvedId === undefined || resolvedId === null) return matchMember(rawName);

  const member = await prisma.member.findUnique({ where: { id: resolvedId } });
  if (!member) return matchMember(rawName);
  if (member.name === newName) return resolvedId;

  const aliases = new Set(
    member.aliases
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
  );
  aliases.add(member.name);

  await prisma.member.update({
    where: { id: resolvedId },
    data: { name: newName, aliases: [...aliases].join(", ") },
  });

  return resolvedId;
}

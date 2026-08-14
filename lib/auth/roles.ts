export type Role = "ADMIN" | "LEADER" | "MEMBER";

type RoleSourceMember = { role: string | null; allianceRank: string | null };

/** Manual override (Member.role) wins; otherwise derived live from allianceRank. */
export function effectiveRole(member: RoleSourceMember): Role {
  if (member.role === "ADMIN" || member.role === "LEADER" || member.role === "MEMBER") {
    return member.role;
  }
  if (member.allianceRank === "R4" || member.allianceRank === "R5") return "LEADER";
  return "MEMBER";
}

import { prisma } from "@/lib/db";

const MATCH_THRESHOLD_RATIO = 0.2;

/**
 * Screenshots show member names prefixed with the alliance tag, e.g.
 * "[RUNE] SomeName" - that's the alliance name, not part of the member's
 * name, so it's stripped before matching/storing.
 */
function stripAllianceTag(name: string): string {
  return name.replace(/^\s*\[[^\]]*\]\s*/, "").trim();
}

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Fuzzy-matches a raw OCR'd member name against the known roster (name + aliases).
 * Creates a new Member row if nothing matches closely enough.
 */
export async function matchMember(rawName: string): Promise<number> {
  const trimmedName = stripAllianceTag(rawName);
  const normalized = normalize(trimmedName);

  const members = await prisma.member.findMany();

  let best: { id: number; distance: number } | null = null;
  for (const member of members) {
    const candidates = [member.name, ...member.aliases.split(",").map((a) => a.trim())].filter(Boolean);
    for (const candidate of candidates) {
      const normalizedCandidate = normalize(candidate);
      if (!normalizedCandidate) continue;
      if (normalizedCandidate === normalized) {
        return member.id;
      }
      const distance = levenshtein(normalized, normalizedCandidate);
      if (!best || distance < best.distance) {
        best = { id: member.id, distance };
      }
    }
  }

  const threshold = Math.max(1, Math.round(normalized.length * MATCH_THRESHOLD_RATIO));
  if (best && best.distance <= threshold) {
    return best.id;
  }

  const created = await prisma.member.create({ data: { name: trimmedName } });
  return created.id;
}

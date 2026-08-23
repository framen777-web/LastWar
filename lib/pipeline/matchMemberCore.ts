const MATCH_THRESHOLD_RATIO = 0.2;

export type MatchableMember = { id: number; name: string; aliases: string };

const ALLIANCE_TAG_PATTERN = /^\s*\[[^\]]*\]\s*/;

/** Whether a raw name is prefixed with the alliance tag, e.g. "[RUNE] SomeName" - only CURRENT
 *  alliance members get this prefix in-game, so its absence marks a departed member on a
 *  screenshot that otherwise covers historical contributors (see runSeasonExtra.ts). */
export function hasAllianceTag(name: string): boolean {
  return ALLIANCE_TAG_PATTERN.test(name);
}

/**
 * Screenshots show member names prefixed with the alliance tag, e.g.
 * "[RUNE] SomeName" - that's the alliance name, not part of the member's
 * name, so it's stripped before matching/storing.
 */
export function stripAllianceTag(name: string): string {
  return name.replace(ALLIANCE_TAG_PATTERN, "").trim();
}

export function normalize(name: string): string {
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
 * Pure fuzzy-match of a raw name against a known roster (name + aliases). No DB access,
 * no writes - returns null when nothing matches closely enough, so callers decide what to
 * do (create a member for real, or just report "no match" in a dry-run preview).
 */
export function findMemberId(rawName: string, members: MatchableMember[]): number | null {
  const trimmedName = stripAllianceTag(rawName);
  const normalized = normalize(trimmedName);

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

  return null;
}

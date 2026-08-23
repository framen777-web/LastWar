const MATCH_THRESHOLD_RATIO = 0.2;

export type MatchableMember = { id: number; name: string; aliases: string };

function allianceTagPattern(allianceTag: string): RegExp {
  const escaped = allianceTag.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*\\[\\s*${escaped}\\s*\\]\\s*`, "i");
}

/**
 * Screenshots show a member's *current* alliance tag prefix, e.g. "[RUNE] SomeName" - the tag
 * itself is a setting (Setup → General → Alliance code), not hardcoded, and matching is always
 * case-insensitive since the game's own rendering of the tag isn't consistently cased (e.g.
 * "RuNE"). A member who left shows either no tag or a different alliance's tag, so "some bracket"
 * isn't enough - it has to specifically be this alliance's tag.
 */
export function hasAllianceTag(name: string, allianceTag: string): boolean {
  return allianceTagPattern(allianceTag).test(name);
}

/**
 * Screenshots show member names prefixed with the alliance tag, e.g.
 * "[RUNE] SomeName" - that's the alliance name, not part of the member's
 * name, so it's stripped before matching/storing.
 */
export function stripAllianceTag(name: string, allianceTag: string = "RUNE"): string {
  return name.replace(allianceTagPattern(allianceTag), "").trim();
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
export function findMemberId(rawName: string, members: MatchableMember[], allianceTag: string = "RUNE"): number | null {
  const trimmedName = stripAllianceTag(rawName, allianceTag);
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

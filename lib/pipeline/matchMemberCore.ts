const MATCH_THRESHOLD_RATIO = 0.2;

export type MatchableMember = { id: number; name: string; aliases: string };

/**
 * The AI extraction reports a row's alliance tag as its own field (alliance_tag), separate from
 * the already-cleaned member_name - see lib/ai/prompts.ts. This just compares that reported tag
 * against the configured alliance tag (Setup → General → Alliance code), case-insensitively since
 * the game doesn't render it consistently cased (e.g. "RuNE"). A departed member's row has either
 * no alliance_tag at all, or a different alliance's tag - both compare unequal here.
 */
export function hasAllianceTag(extractedTag: string | null | undefined, allianceTag: string): boolean {
  if (!extractedTag) return false;
  return extractedTag.trim().toLowerCase() === allianceTag.trim().toLowerCase();
}

/**
 * Screenshots show member names prefixed with the alliance tag, e.g.
 * "[RUNE] SomeName" - that's the alliance name, not part of the member's
 * name, so it's stripped before matching/storing. Kept as a simple generic-bracket strip (not
 * tied to the configured allianceTag) since the AI extraction already excludes the tag from
 * member_name itself (see buildExtractionPrompt) - this is just a harmless safety net for
 * whatever a raw/unprocessed name string still happens to carry.
 */
export function stripAllianceTag(name: string): string {
  return name.replace(/^\s*\[[^\]]*\]\s*/, "").trim();
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

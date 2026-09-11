const NAME_MATCH_THRESHOLD_RATIO = 0.2;
// Aliases are already confirmed variants of a real person's name (recorded by an explicit
// merge or rename - see app/api/users/merge/route.ts and the rename handler in
// app/api/users/[id]/route.ts), not a guess the way a bare name comparison is. A new OCR
// reading landing close to an already-confirmed variant is very likely more of the same
// noise for that same person, so aliases get a looser tolerance than the canonical name -
// this is the main lever for garbled/mixed-script names that read a little differently on
// every import. MIN_LENGTH_FOR_FUZZY_MATCH below still requires an exact hit for very short
// names regardless of which list matched, so this doesn't reopen the short-name over-merge
// risk that was fixed separately.
const ALIAS_MATCH_THRESHOLD_RATIO = 0.35;
// Below this many (code-point) characters, only an exact normalized match auto-links to an
// existing member. A 1-character difference in a short name is often a genuinely different
// person ("Inktest" vs "minktest": edit distance 1, which the old ratio-only threshold rounded
// up to "close enough" and silently combined two different people's stats) rather than OCR
// noise. Longer names keep proportional typo tolerance, since a 1-2 character slip on a long
// name is far less likely to coincidentally land on a different real person's name.
const MIN_LENGTH_FOR_FUZZY_MATCH = 8;

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
  const aChars = Array.from(a);
  const bChars = Array.from(b);
  const dp: number[][] = Array.from({ length: aChars.length + 1 }, () => new Array(bChars.length + 1).fill(0));
  for (let i = 0; i <= aChars.length; i++) dp[i][0] = i;
  for (let j = 0; j <= bChars.length; j++) dp[0][j] = j;
  for (let i = 1; i <= aChars.length; i++) {
    for (let j = 1; j <= bChars.length; j++) {
      const cost = aChars[i - 1] === bChars[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[aChars.length][bChars.length];
}

/**
 * Pure fuzzy-match of a raw name against a known roster (name + aliases). No DB access,
 * no writes - returns null when nothing matches closely enough, so callers decide what to
 * do (create a member for real, or just report "no match" in a dry-run preview).
 */
export function findMemberId(rawName: string, members: MatchableMember[]): number | null {
  const trimmedName = stripAllianceTag(rawName);
  const normalized = normalize(trimmedName);
  const normalizedLength = Array.from(normalized).length;

  let best: { id: number; distance: number; ratio: number } | null = null;
  for (const member of members) {
    const candidates: [string, number][] = [
      [member.name, NAME_MATCH_THRESHOLD_RATIO],
      ...member.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean)
        .map((a): [string, number] => [a, ALIAS_MATCH_THRESHOLD_RATIO]),
    ];

    for (const [candidate, ratio] of candidates) {
      const normalizedCandidate = normalize(candidate);
      if (!normalizedCandidate) continue;
      if (normalizedCandidate === normalized) {
        return member.id;
      }
      const distance = levenshtein(normalized, normalizedCandidate);
      if (!best || distance < best.distance) {
        best = { id: member.id, distance, ratio };
      }
    }
  }

  if (!best) return null;
  const threshold =
    normalizedLength >= MIN_LENGTH_FOR_FUZZY_MATCH ? Math.max(1, Math.round(normalizedLength * best.ratio)) : 0;
  return best.distance <= threshold ? best.id : null;
}

export type MatchCandidate = { id: number; name: string; distance: number; similarity: number };

/**
 * Best fuzzy match for `name` among `members`, excluding `excludeId` (the member being
 * evaluated itself). Unlike findMemberId, this always returns the closest candidate
 * regardless of any auto-match threshold, with a similarity score (0-1) the caller decides
 * what to do with. Used to surface "this new unconfirmed member looks like an existing one"
 * hints on Setup → Users - a garbled name can land close enough to be worth a human glance
 * without ever being close enough to safely auto-match.
 */
export function bestMatchExcluding(name: string, excludeId: number, members: MatchableMember[]): MatchCandidate | null {
  const normalized = normalize(stripAllianceTag(name));
  if (!normalized) return null;

  let best: MatchCandidate | null = null;
  for (const member of members) {
    if (member.id === excludeId) continue;
    const candidates = [member.name, ...member.aliases.split(",").map((a) => a.trim())].filter(Boolean);
    for (const candidate of candidates) {
      const normalizedCandidate = normalize(candidate);
      if (!normalizedCandidate) continue;
      const distance = levenshtein(normalized, normalizedCandidate);
      const longer = Math.max(normalized.length, normalizedCandidate.length, 1);
      const similarity = 1 - distance / longer;
      if (!best || similarity > best.similarity) {
        best = { id: member.id, name: member.name, distance, similarity };
      }
    }
  }
  return best;
}

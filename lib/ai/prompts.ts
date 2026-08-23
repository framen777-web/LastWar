export const CONFIDENCE_THRESHOLD = 0.6;

export type CategoryForPrompt = {
  key: string;
  name: string;
  description: string | null;
  shape: string;
};

// The two extraction shapes this app's pipeline knows how to read. New categories
// pick one of these rather than needing new extraction code - this is the "reuse an
// existing shape" extensibility path.
export const SHAPE_FIELDS: Record<string, { key: string; label: string; numeric: boolean }[]> = {
  ranking_list: [
    { key: "rank", label: "Rank", numeric: false },
    { key: "member_name", label: "Member name", numeric: false },
    { key: "value", label: "Value", numeric: true },
    { key: "alliance_rank", label: "Alliance rank (R1-R5)", numeric: false },
    { key: "event_date", label: "Event date (if printed on the screenshot)", numeric: false },
  ],
  roster: [
    { key: "name", label: "Name", numeric: false },
    { key: "level", label: "HQ level", numeric: true },
    { key: "status", label: "Status", numeric: false },
    { key: "last_active", label: "Last active", numeric: false },
    { key: "alliance_rank", label: "Alliance rank (R1-R5)", numeric: false },
  ],
  // Free-text chat/announcement content (e.g. squad composition self-reports) - lower
  // confidence than a structured screenshot, always held for manual confirmation
  // before it's written (see runPipelineForImage in lib/pipeline/run.ts).
  free_text: [
    { key: "member_name", label: "Member name", numeric: false },
    { key: "air", label: "Air", numeric: true },
    { key: "tank", label: "Tank", numeric: true },
    { key: "missile", label: "Missile", numeric: true },
    { key: "fourth", label: "Fourth", numeric: true },
  ],
};

export function buildClassifyPrompt(categories: CategoryForPrompt[]): string {
  const lines = categories
    .map((c) => `- "${c.key}": ${c.description?.trim() || c.name}`)
    .join("\n");

  return `You are classifying a screenshot from a mobile alliance-strategy game into exactly one of the following categories. Judge by the on-screen LAYOUT and SHAPE (which columns/blocks are present), not by matching specific English words, since some clients are localized.

${lines}

If the screenshot clearly matches one of these categories, return that category's key. If it does not confidently match any of them, return "unknown". Always return a confidence score between 0 and 1 reflecting how sure you are.`;
}

export function buildClassifySchema(categories: CategoryForPrompt[]): unknown {
  return {
    type: "object",
    properties: {
      category_key: {
        type: "string",
        description: `One of: ${categories.map((c) => c.key).join(", ")}, unknown`,
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["category_key", "confidence"],
  };
}

const RANKING_LIST_SCHEMA = {
  type: "object",
  properties: {
    event_date: {
      type: "string",
      description:
        "Event date/timestamp printed on the screenshot, if there is one (e.g. near the bottom of a battle report). Omit if there is none.",
    },
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rank: { type: "integer" },
          member_name: { type: "string" },
          value: {
            type: "number",
            description:
              "The numeric stat for this row. Full number with any K/M/B/G magnitude suffix expanded (e.g. '89.5M' -> 89500000). Never report just the leading digits without applying the suffix's multiplier.",
          },
          alliance_rank: {
            type: "string",
            description:
              "The R1-R5 alliance role badge next to the member's name, if visible. Omit or null if not visible.",
          },
          alliance_tag: {
            type: "string",
            description:
              "The bracketed alliance tag shown before this member's name, if any - e.g. 'RUNE' from " +
              "'[RUNE] SomeName' (just the tag text, no brackets). Omit or null if the name had no " +
              "bracket prefix at all.",
          },
        },
        required: ["rank", "member_name", "value"],
      },
    },
  },
  required: ["rows"],
};

const ROSTER_SCHEMA = {
  type: "object",
  properties: {
    members: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          level: { type: "integer", description: "HQ level shown next to the member." },
          status: { type: "string", description: "e.g. Online, Offline, Away" },
          last_active: { type: "string", description: "As shown on screen, free text (e.g. '2 hours ago')." },
          alliance_rank: { type: "string", description: "R1-R5 role badge, if visible." },
        },
        required: ["name"],
      },
    },
  },
  required: ["members"],
};

const FREE_TEXT_SCHEMA = {
  type: "object",
  properties: {
    members: {
      type: "array",
      items: {
        type: "object",
        properties: {
          member_name: { type: "string" },
          values: {
            type: "array",
            description:
              "Every troop-composition number this member reported, as plain decimal values (e.g. 2.5) - NOT percentages, in the exact order they appear in the message.",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["air", "tank", "missile", "fourth"],
                  description:
                    "Which troop type this number is, ONLY if a letter/label (a/air, t/tank, m/missile, f/fourth/l) was explicitly attached to it in the message. Omit this property entirely if the number had no label.",
                },
                value: { type: "number" },
              },
              required: ["value"],
            },
          },
        },
        required: ["member_name", "values"],
      },
    },
  },
  required: ["members"],
};

export function getExtractionSchema(shape: string): unknown {
  if (shape === "ranking_list") return RANKING_LIST_SCHEMA;
  if (shape === "roster") return ROSTER_SCHEMA;
  if (shape === "free_text") return FREE_TEXT_SCHEMA;
  throw new Error(`No extraction schema for shape "${shape}"`);
}

export function buildExtractionPrompt(category: CategoryForPrompt): string {
  const description = category.description?.trim() || category.name;
  const intro = `This screenshot is from the "${category.name}" screen: ${description}`;

  if (category.shape === "free_text") {
    return `${intro}

This is free-text chat/announcement content, not a structured table - members self-report their troop composition in inconsistent shorthand (e.g. "air 2.5 tank 1.8 missile 0.9 fourth 0.3", or abbreviated like "a2.5 t1.8 m0.9 f0.3"), in any order, possibly missing some values, and sometimes with NO letters/labels at all (just raw numbers like "2.5 1.8 0.9 0.3"). One message is usually one member.

Report every numeric value the member gave, in "values", in the exact order they appear in the message - do not reorder or deduplicate them. For each number, set "type" to whichever troop type its label unambiguously names (a/air, t/tank, m/missile, f/fourth/l) ONLY if that number actually had a letter/label attached to it in the source text. If a number has no label at all, omit "type" for it entirely - do NOT guess which troop type an unlabeled number is, that assignment is handled deterministically downstream from the order you report them in. These are plain decimal values (e.g. 2.5, 0.25, 10) - NOT percentages. Do not add a % sign, and do not multiply or divide by 100 - report the number exactly as written. Member names are sometimes prefixed with the alliance's tag in brackets, e.g. "[RUNE] SomeName" — exclude that tag from "member_name", report only the person's display name. If you're not fully confident in a reading, still report your best guess - low confidence is expected here and this data is reviewed by a person before it's used for anything.`;
  }

  return `${intro}

Extract every visible row/member exactly as shown. Read member names carefully (they may contain unusual characters/emoji — transcribe as best you can). Do not invent rows that aren't visible. If the "alliance_rank" (R1-R5) badge isn't visible for a member, omit that field for them rather than guessing. Member names are sometimes prefixed with the alliance's tag in brackets, e.g. "[RUNE] SomeName" — that bracketed tag is the alliance name, not part of the member's name; exclude it from "member_name"/"name" and report only the person's actual display name. Separately, also report that tag's text (without brackets) in "alliance_tag" if one was shown - e.g. "RUNE" - so a downstream check can tell who currently carries it. Omit "alliance_tag" entirely if the name had no bracket prefix.

Numeric values are often abbreviated with a magnitude suffix — K (thousand), M (million), B (billion), G (also billion in some locales) — e.g. "89.5M" or "1.2B". Always expand these to the full number before reporting: "89.5M" = 89500000, "1.2B" = 1200000000. Never report just the leading digits without applying the suffix's multiplier.`;
}

import { prisma } from "../lib/db";

const RANKING_LIST_FIELDS = ["rank", "member_name", "value", "alliance_rank"];
const RANKING_LIST_FIELDS_WITH_DATE = [...RANKING_LIST_FIELDS, "event_date"];
const ROSTER_FIELDS = ["name", "level", "status", "last_active", "alliance_rank"];
const FREE_TEXT_FIELDS = ["member_name", "air", "tank", "missile", "fourth"];

const CATEGORIES = [
  {
    key: "power",
    name: "Power",
    description:
      "A ranking list screen titled around 'Power' or 'Strength Ranking', showing rows of rank number, member name, an optional role badge (R1-R5), and a large power number per row.",
    shape: "ranking_list",
    divisor: 1000,
    divisorLabel: "raw power ÷ 1000",
    importMode: "single",
    dedupField: null,
    storedFields: RANKING_LIST_FIELDS,
    valueField: "value",
    sortOrder: 0,
  },
  {
    key: "kills",
    name: "Kills",
    description:
      "A ranking list screen titled around 'Kills' or 'Strength Ranking - Kills', showing rows of rank number, member name, role badge, and a kill count per row.",
    shape: "ranking_list",
    divisor: 1,
    divisorLabel: null,
    importMode: "single",
    dedupField: null,
    storedFields: RANKING_LIST_FIELDS,
    valueField: "value",
    sortOrder: 1,
  },
  {
    key: "donations",
    name: "Donations",
    description:
      "A ranking list screen titled around 'Donation', showing rows of rank number, member name, role badge, and a donation points number per row. May have a Daily/Weekly toggle visible.",
    shape: "ranking_list",
    divisor: 1,
    divisorLabel: null,
    importMode: "single",
    dedupField: null,
    storedFields: RANKING_LIST_FIELDS,
    valueField: "value",
    sortOrder: 2,
  },
  {
    key: "vs",
    name: "VS",
    description:
      "A ranking list screen, possibly in a non-English language (e.g. Italian 'Classifica'), showing rows of rank number, member name, alliance tag, and a points number. Recognize by the ranked-list SHAPE, not by English text.",
    shape: "ranking_list",
    divisor: 1000,
    divisorLabel: "raw points ÷ 1000",
    importMode: "single",
    dedupField: null,
    storedFields: RANKING_LIST_FIELDS,
    valueField: "value",
    sortOrder: 3,
  },
  {
    key: "desert_storm",
    name: "Desert Storm",
    description:
      "A mail/message screen titled '[Desert Storm] Battle Results', showing a ranking list of rank, member name, and a damage number, with an event timestamp visible in the image.",
    shape: "ranking_list",
    divisor: 1,
    divisorLabel: null,
    importMode: "single",
    dedupField: null,
    storedFields: RANKING_LIST_FIELDS,
    valueField: "value",
    sortOrder: 4,
  },
  {
    key: "ae",
    name: "Alliance Exercise",
    description:
      "A mail/message screen titled '[Alliance Exercise] Alliance Reward', with a distinct highlighted MVP block at the top (one member's name, power, attacks, total damage) followed by a 'Damage Ranking 2-20' list below it, and an event date/timestamp printed near the bottom. Report the MVP as rank 1 in the rows list, followed by the ranking list continuing from rank 2. AE can run more than once a week - the event date is what identifies a distinct occurrence.",
    shape: "ranking_list",
    divisor: 1_000_000,
    divisorLabel: "raw damage ÷ 1,000,000",
    importMode: "multi",
    dedupField: "event_date",
    storedFields: RANKING_LIST_FIELDS_WITH_DATE,
    valueField: "value",
    sortOrder: 5,
  },
  {
    key: "members",
    name: "Members",
    description:
      "A roster/Members screen showing many members at once, each with a role badge (Warlord/Recruiter/Muse/Butler/Elite), HQ level, last-active time, and online status. Not a ranked competition list.",
    shape: "roster",
    divisor: 1,
    divisorLabel: null,
    importMode: "single",
    dedupField: null,
    storedFields: ROSTER_FIELDS,
    valueField: "level",
    sortOrder: 6,
  },
  {
    key: "squads",
    name: "Squads",
    description:
      "Alliance Announcement chat where members self-report their Air/Tank/Missile/Fourth troop composition as decimal numbers, one message per person, in inconsistent shorthand (e.g. 'air 2.5 tank 1.8 missile 0.9 fourth 0.3'). Free text, not a structured screen.",
    shape: "free_text",
    divisor: 1,
    divisorLabel: null,
    importMode: "single",
    dedupField: null,
    storedFields: FREE_TEXT_FIELDS,
    valueField: "",
    sortOrder: 7,
  },
];

async function main() {
  for (const category of CATEGORIES) {
    const data = {
      name: category.name,
      description: category.description,
      shape: category.shape,
      divisor: category.divisor,
      divisorLabel: category.divisorLabel,
      importMode: category.importMode,
      dedupField: category.dedupField,
      storedFields: JSON.stringify(category.storedFields),
      valueField: category.valueField,
      sortOrder: category.sortOrder,
    };
    await prisma.category.upsert({
      where: { key: category.key },
      update: data,
      create: { key: category.key, ...data },
    });
  }
  console.log(`Seeded ${CATEGORIES.length} categories.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });

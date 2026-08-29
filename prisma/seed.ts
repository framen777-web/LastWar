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

// One row per navigable MenuButton in the app - see lib/menuAccess.ts. Every new button
// added to any hub page must get an entry here too, or it's invisible to everyone
// (fail-closed). Keep this list in sync with the actual JSX across app/page.tsx,
// app/new-information/page.tsx, app/reports/page.tsx, app/setup/page.tsx,
// app/setup/users/page.tsx, app/dashboards/page.tsx, and app/dashboards/alliance/page.tsx.
const MENU_ITEMS = [
  { key: "home-my-stats", label: "Detail List", href: "/dashboard", roles: ["MEMBER"], parentKey: null },
  { key: "home-uploads", label: "Uploads", href: "/new-information", roles: ["ADMIN", "LEADER"], parentKey: null },
  { key: "home-conductor", label: "Conductor", href: "/conductor", roles: ["ADMIN", "LEADER"], parentKey: null },
  {
    key: "conductor-select",
    label: "Select Conductors & Passengers",
    href: "/conductor/select",
    roles: ["ADMIN", "LEADER"],
    parentKey: "home-conductor",
  },
  { key: "conductor-history", label: "History", href: "/conductor/history", roles: ["ADMIN", "LEADER"], parentKey: "home-conductor" },
  {
    key: "conductor-standings",
    label: "Standings",
    href: "/conductor/standings",
    roles: ["ADMIN", "LEADER"],
    parentKey: "home-conductor",
  },
  { key: "home-dashboards", label: "Reports", href: "/dashboards", roles: ["ADMIN", "LEADER", "MEMBER"], parentKey: null },
  { key: "home-settings", label: "Settings", href: "/setup", roles: ["ADMIN"], parentKey: null },

  { key: "uploads-image-uploads", label: "Image uploads", href: "/upload", roles: ["ADMIN"], parentKey: "home-uploads" },
  { key: "uploads-review", label: "Upload review", href: "/dashboard", roles: ["ADMIN", "LEADER"], parentKey: "home-uploads" },
  {
    key: "uploads-multi-event-review",
    label: "Multi Event review",
    href: "/dashboard/multi",
    roles: ["ADMIN", "LEADER"],
    parentKey: "home-uploads",
  },
  { key: "uploads-flagged-errors", label: "Flagged errors", href: "/review", roles: ["ADMIN"], parentKey: "home-uploads" },

  {
    key: "dashboards-individual",
    label: "Individual Dashboard",
    href: "/dashboards/individual",
    roles: ["ADMIN", "LEADER", "MEMBER"],
    parentKey: "home-dashboards",
  },
  {
    key: "individual-detail-list",
    label: "Detail List",
    href: "/dashboards/individual/detail",
    roles: ["ADMIN", "LEADER", "MEMBER"],
    parentKey: "dashboards-individual",
  },
  {
    key: "individual-graphs",
    label: "Graphs",
    href: "/dashboards/individual/graphs",
    roles: ["ADMIN", "LEADER", "MEMBER"],
    parentKey: "dashboards-individual",
  },
  {
    key: "dashboards-alliance",
    label: "Alliance Reports",
    href: "/dashboards/alliance",
    roles: ["ADMIN", "LEADER"],
    parentKey: "home-dashboards",
  },

  {
    key: "alliance-detail-report",
    label: "Detail Report",
    href: "/dashboards/alliance/detail",
    roles: ["ADMIN", "LEADER"],
    parentKey: "dashboards-alliance",
  },
  {
    key: "alliance-graphs",
    label: "Graphs",
    href: "/dashboards/alliance/graphs",
    roles: ["ADMIN", "LEADER"],
    parentKey: "dashboards-alliance",
  },
  {
    key: "alliance-member-movement",
    label: "Member Movement",
    href: "/dashboards/alliance/member-movement",
    roles: ["ADMIN", "LEADER"],
    parentKey: "dashboards-alliance",
  },

  {
    key: "home-end-of-week-reports",
    label: "End of Week Reports",
    href: "/reports",
    roles: ["ADMIN", "LEADER"],
    parentKey: "home-dashboards",
  },

  {
    key: "dashboards-season",
    label: "Season Reports",
    href: "/dashboards/season",
    roles: ["ADMIN", "LEADER", "MEMBER"],
    parentKey: "home-dashboards",
  },

  { key: "reports-hq", label: "HQ Levels", href: "/reports/hq", roles: ["ADMIN", "LEADER"], parentKey: "home-end-of-week-reports" },
  {
    key: "reports-leaderboard",
    label: "Leaderboards",
    href: "/reports/leaderboard",
    roles: ["ADMIN", "LEADER"],
    parentKey: "home-end-of-week-reports",
  },
  {
    key: "reports-new-records",
    label: "New Records",
    href: "/reports/new-records",
    roles: ["ADMIN", "LEADER"],
    parentKey: "home-end-of-week-reports",
  },
  { key: "reports-clubs", label: "VS Clubs", href: "/reports/clubs", roles: ["ADMIN", "LEADER"], parentKey: "home-end-of-week-reports" },
  {
    key: "reports-squads",
    label: "Squads",
    href: "/reports/squad-power",
    roles: ["ADMIN", "LEADER"],
    parentKey: "home-end-of-week-reports",
  },
  { key: "reports-mvp", label: "MVP Report", href: "/reports/mvp", roles: ["ADMIN", "LEADER"], parentKey: "home-end-of-week-reports" },
  { key: "reports-r1", label: "R1 Report", href: "/reports/r1", roles: ["ADMIN", "LEADER"], parentKey: "home-end-of-week-reports" },

  { key: "settings-general", label: "General", href: "/settings", roles: ["ADMIN"], parentKey: "home-settings" },
  { key: "settings-users", label: "Users", href: "/setup/users", roles: ["ADMIN"], parentKey: "home-settings" },
  { key: "users-list", label: "Users", href: "/setup/users/list", roles: ["ADMIN"], parentKey: "settings-users" },
  { key: "users-merge", label: "Merge", href: "/setup/users/merge", roles: ["ADMIN"], parentKey: "settings-users" },
  { key: "users-menu-access", label: "Menu Access", href: "/setup/users/menu-access", roles: ["ADMIN"], parentKey: "settings-users" },
  { key: "settings-categories", label: "Categories", href: "/setup/categories", roles: ["ADMIN"], parentKey: "home-settings" },
  { key: "settings-mvp-weighting", label: "MVP Weighting", href: "/setup/mvp-weights", roles: ["ADMIN"], parentKey: "home-settings" },
  { key: "settings-conductor", label: "Conductor Settings", href: "/setup/conductor", roles: ["ADMIN"], parentKey: "home-settings" },
  {
    key: "settings-import-history",
    label: "Import History",
    href: "/setup/import-history",
    roles: ["ADMIN"],
    parentKey: "home-settings",
  },
  {
    key: "settings-import-conductor-history",
    label: "Import Conductor History",
    href: "/setup/import-conductor-history",
    roles: ["ADMIN"],
    parentKey: "home-settings",
  },
  { key: "settings-seasons", label: "Seasons", href: "/setup/seasons", roles: ["ADMIN"], parentKey: "home-settings" },
  { key: "settings-backup", label: "Backup & Restore", href: "/setup/backup", roles: ["ADMIN"], parentKey: "home-settings" },
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

  // `roles` is the one admin-customized field (edited from Menu Access) - never touched on
  // an existing row. `label`/`href`/`sortOrder`/`parentKey` are code-owned (there's no UI to
  // change them), so those stay in sync with MENU_ITEMS on every run - sortOrder is this
  // array's own position, and parentKey drives the Menu Access page's tree structure, so the
  // page always mirrors the real nav hierarchy exactly.
  let menuItemsCreated = 0;
  let menuItemsUpdated = 0;
  for (const [sortOrder, item] of MENU_ITEMS.entries()) {
    const existing = await prisma.menuItem.findUnique({ where: { key: item.key } });
    if (existing) {
      if (
        existing.label !== item.label ||
        existing.href !== item.href ||
        existing.sortOrder !== sortOrder ||
        existing.parentKey !== item.parentKey
      ) {
        await prisma.menuItem.update({
          where: { key: item.key },
          data: { label: item.label, href: item.href, sortOrder, parentKey: item.parentKey },
        });
        menuItemsUpdated++;
      }
      continue;
    }
    await prisma.menuItem.create({
      data: { key: item.key, label: item.label, href: item.href, sortOrder, parentKey: item.parentKey, roles: JSON.stringify(item.roles) },
    });
    menuItemsCreated++;
  }
  console.log(
    `Menu items: ${menuItemsCreated} created, ${menuItemsUpdated} updated (label/href/sortOrder), ${
      MENU_ITEMS.length - menuItemsCreated - menuItemsUpdated
    } unchanged.`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });

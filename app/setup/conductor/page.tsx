import { requireMenuAccess } from "@/lib/menuAccess";
import { getRankableCategories } from "@/lib/conductor/stats";
import { ConductorSettingsClient } from "./ConductorSettingsClient";

export default async function ConductorSettingsPage() {
  await requireMenuAccess("settings-conductor");
  const categories = await getRankableCategories();
  return <ConductorSettingsClient categories={categories} />;
}

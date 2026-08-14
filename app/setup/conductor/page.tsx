import { requireAdmin } from "@/lib/auth/dal";
import { getRankableCategories } from "@/lib/conductor/stats";
import { ConductorSettingsClient } from "./ConductorSettingsClient";

export default async function ConductorSettingsPage() {
  await requireAdmin();
  const categories = await getRankableCategories();
  return <ConductorSettingsClient categories={categories} />;
}

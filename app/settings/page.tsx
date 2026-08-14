import { requireAdmin } from "@/lib/auth/dal";
import { SettingsClient } from "./SettingsClient";

export default async function SettingsPage() {
  await requireAdmin();
  return <SettingsClient />;
}

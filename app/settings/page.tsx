import { requireMenuAccess } from "@/lib/menuAccess";
import { SettingsClient } from "./SettingsClient";

export default async function SettingsPage() {
  await requireMenuAccess("settings-general");
  return <SettingsClient />;
}

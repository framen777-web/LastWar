import { requireMenuAccess } from "@/lib/menuAccess";
import { SeasonsListClient } from "./SeasonsListClient";

export default async function SeasonsPage() {
  await requireMenuAccess("settings-seasons");
  return <SeasonsListClient />;
}

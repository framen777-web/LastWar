import { requireMenuAccess } from "@/lib/menuAccess";
import { ImportConductorHistoryClient } from "./ImportConductorHistoryClient";

export default async function ImportConductorHistoryPage() {
  await requireMenuAccess("settings-import-conductor-history");
  return <ImportConductorHistoryClient />;
}

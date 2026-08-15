import { requireMenuAccess } from "@/lib/menuAccess";
import { ImportHistoryClient } from "./ImportHistoryClient";

export default async function ImportHistoryPage() {
  await requireMenuAccess("settings-import-history");
  return <ImportHistoryClient />;
}

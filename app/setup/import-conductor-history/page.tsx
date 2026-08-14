import { requireAdmin } from "@/lib/auth/dal";
import { ImportConductorHistoryClient } from "./ImportConductorHistoryClient";

export default async function ImportConductorHistoryPage() {
  await requireAdmin();
  return <ImportConductorHistoryClient />;
}

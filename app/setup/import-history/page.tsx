import { requireAdmin } from "@/lib/auth/dal";
import { ImportHistoryClient } from "./ImportHistoryClient";

export default async function ImportHistoryPage() {
  await requireAdmin();
  return <ImportHistoryClient />;
}

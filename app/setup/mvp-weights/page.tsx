import { requireAdmin } from "@/lib/auth/dal";
import { MvpWeightsClient } from "./MvpWeightsClient";

export default async function MvpWeightsPage() {
  await requireAdmin();
  return <MvpWeightsClient />;
}

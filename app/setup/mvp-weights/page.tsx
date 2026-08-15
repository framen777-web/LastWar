import { requireMenuAccess } from "@/lib/menuAccess";
import { MvpWeightsClient } from "./MvpWeightsClient";

export default async function MvpWeightsPage() {
  await requireMenuAccess("settings-mvp-weighting");
  return <MvpWeightsClient />;
}

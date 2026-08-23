import { requireMenuAccess } from "@/lib/menuAccess";
import { SeasonDetailClient } from "./SeasonDetailClient";

export default async function SeasonDetailPage({ params }: PageProps<"/setup/seasons/[id]">) {
  await requireMenuAccess("settings-seasons");
  const { id } = await params;
  return <SeasonDetailClient seasonId={Number(id)} />;
}

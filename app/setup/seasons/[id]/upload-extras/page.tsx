import { requireMenuAccess } from "@/lib/menuAccess";
import { UploadExtrasClient } from "./UploadExtrasClient";

export default async function UploadExtrasPage({ params }: PageProps<"/setup/seasons/[id]/upload-extras">) {
  await requireMenuAccess("settings-seasons");
  const { id } = await params;
  return <UploadExtrasClient seasonId={Number(id)} />;
}

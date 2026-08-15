import { requireMenuAccess } from "@/lib/menuAccess";
import { UploadClient } from "./UploadClient";

export default async function UploadPage() {
  await requireMenuAccess("uploads-image-uploads");
  return <UploadClient />;
}

import { requireAdmin } from "@/lib/auth/dal";
import { UploadClient } from "./UploadClient";

export default async function UploadPage() {
  await requireAdmin();
  return <UploadClient />;
}

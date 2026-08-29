import { requireMenuAccess } from "@/lib/menuAccess";
import { BackupRestoreClient } from "./BackupRestoreClient";

export default async function BackupPage() {
  await requireMenuAccess("settings-backup");
  return <BackupRestoreClient />;
}

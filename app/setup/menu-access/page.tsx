import { requireMenuAccess } from "@/lib/menuAccess";
import { MenuAccessClient } from "./MenuAccessClient";

export default async function MenuAccessPage() {
  await requireMenuAccess("settings-menu-access");
  return <MenuAccessClient />;
}

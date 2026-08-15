import { requireMenuAccess } from "@/lib/menuAccess";
import { MenuAccessClient } from "./MenuAccessClient";

export default async function MenuAccessPage() {
  await requireMenuAccess("users-menu-access");
  return <MenuAccessClient />;
}

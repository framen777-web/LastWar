import { requireAdmin } from "@/lib/auth/dal";
import { MenuAccessClient } from "./MenuAccessClient";

export default async function MenuAccessPage() {
  await requireAdmin();
  return <MenuAccessClient />;
}

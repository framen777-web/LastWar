import { requireAdmin } from "@/lib/auth/dal";
import { CategoriesClient } from "./CategoriesClient";

export default async function CategoriesPage() {
  await requireAdmin();
  return <CategoriesClient />;
}

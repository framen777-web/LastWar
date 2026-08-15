import { requireMenuAccess } from "@/lib/menuAccess";
import { CategoriesClient } from "./CategoriesClient";

export default async function CategoriesPage() {
  await requireMenuAccess("settings-categories");
  return <CategoriesClient />;
}

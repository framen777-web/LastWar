"use server";

import { redirect } from "next/navigation";
import { deleteSession } from "./session";

export async function logout() {
  await deleteSession();
  redirect("/login");
}

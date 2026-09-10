import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { UsersManager } from "@/components/users-manager";

export default async function UsersPage() {
  const session = await getSession();

  if (session?.role !== "ADMIN") {
    redirect("/");
  }

  return <UsersManager />;
}

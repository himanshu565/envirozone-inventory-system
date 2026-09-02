import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { UsersManager } from "@/components/users-manager";

export default async function UsersPage() {
  const session = await getSession();

  if (session?.role !== "ADMIN") {
    redirect("/");
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-4 py-16 dark:bg-black">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        Manage users
      </h1>
      <UsersManager />
    </div>
  );
}

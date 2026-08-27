import { getSession } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

export default async function Home() {
  const session = await getSession();

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-center gap-4 py-32 px-16 bg-white dark:bg-black">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Signed in as {session?.email} ({session?.role})
        </h1>
        <LogoutButton />
      </main>
    </div>
  );
}

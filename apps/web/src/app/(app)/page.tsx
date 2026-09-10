import { getSession } from "@/lib/auth";
import { Dashboard } from "@/components/dashboard";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;

  return <Dashboard role={session.role} />;
}

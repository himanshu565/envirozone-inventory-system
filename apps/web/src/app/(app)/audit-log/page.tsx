import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AuditLogViewer } from "@/components/audit-log-viewer";

export default async function AuditLogPage() {
  const session = await getSession();

  if (session?.role !== "ADMIN") {
    redirect("/");
  }

  return <AuditLogViewer />;
}

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { OrganizationSettings } from "@/components/settings/organization-settings";

export default async function SettingsPage() {
  const session = await getSession();

  if (session?.role !== "ADMIN") {
    redirect("/");
  }

  return <OrganizationSettings />;
}

"use client";

import NewUsagePage from "./_components/components/UsagePageView";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { useTeams } from "@/app/(dashboard)/hooks/teams/useTeams";
import { useOrganizations } from "@/app/(dashboard)/hooks/organizations/useOrganizations";
import { all_admin_roles } from "@/utils/roles";

export default function UsagePage() {
  const { userRole } = useAuthorized();
  const isAdmin = all_admin_roles.includes(userRole || "");
  const { data: teams } = useTeams();
  const { data: organizations } = useOrganizations(undefined, { enabled: isAdmin });
  return <NewUsagePage teams={teams ?? []} organizations={organizations ?? []} />;
}

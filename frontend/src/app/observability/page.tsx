import { redirect } from "next/navigation";
import { authorizeAdmin } from "@/lib/adminAccess";
import ObservabilityDashboard from "@/components/ObservabilityDashboard";

export const dynamic = "force-dynamic";

export default async function ObservabilityPage() {
  if (!(await authorizeAdmin())) redirect("/");
  return <ObservabilityDashboard />;
}

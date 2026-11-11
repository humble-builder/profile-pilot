import {
  authorizeAdmin,
  forwardBackendResponse,
  getAdminBackendConfig,
} from "@/lib/adminAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await authorizeAdmin())) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { baseUrl, adminToken } = getAdminBackendConfig();
    const requestUrl = new URL(request.url);
    const query = new URLSearchParams();
    for (const key of ["from", "to", "limit"]) {
      const value = requestUrl.searchParams.get(key);
      if (value) query.set(key, value);
    }
    const response = await fetch(
      `${baseUrl}/service/admin/observability?${query.toString()}`,
      { headers: { "x-admin-token": adminToken }, cache: "no-store" },
    );
    return forwardBackendResponse(response);
  } catch (error) {
    console.error("Could not load observability data:", error);
    return Response.json({ error: "Observability data is unavailable" }, { status: 503 });
  }
}

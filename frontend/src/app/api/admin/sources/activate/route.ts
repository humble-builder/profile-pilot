import {
  authorizeAdmin,
  forwardBackendResponse,
  getAdminBackendConfig,
} from "@/lib/adminAccess";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await authorizeAdmin())) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { sourceId, revisionId } = await request.json();
    const { baseUrl, adminToken } = getAdminBackendConfig();
    const response = await fetch(`${baseUrl}/service/admin/sources/activate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-token": adminToken,
      },
      body: JSON.stringify({ sourceId, revisionId }),
      cache: "no-store",
    });

    return forwardBackendResponse(response);
  } catch (error) {
    console.error("Could not activate source revision:", error);
    return Response.json({ error: "Source activation failed" }, { status: 503 });
  }
}

import {
  authorizeAdmin,
  forwardBackendResponse,
  getAdminBackendConfig,
} from "@/lib/adminAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function forwardSettingsRequest(method: "GET" | "PUT", body?: unknown) {
  if (!(await authorizeAdmin())) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { baseUrl, adminToken } = getAdminBackendConfig();
    const response = await fetch(`${baseUrl}/service/admin/settings`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        "x-admin-token": adminToken,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
    });
    return forwardBackendResponse(response);
  } catch (error) {
    console.error("Could not access runtime settings:", error);
    return Response.json({ error: "Runtime settings are unavailable" }, { status: 503 });
  }
}

export async function GET() {
  return forwardSettingsRequest("GET");
}

export async function PUT(request: Request) {
  return forwardSettingsRequest("PUT", await request.json());
}

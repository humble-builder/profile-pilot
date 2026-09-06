import { NextRequest } from "next/server";
import {
  authorizeAdmin,
  forwardBackendResponse,
  getAdminBackendConfig,
} from "@/lib/adminAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await authorizeAdmin())) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { baseUrl, adminToken } = getAdminBackendConfig();
    const response = await fetch(`${baseUrl}/service/admin/sources`, {
      headers: { "x-admin-token": adminToken },
      cache: "no-store",
    });
    return forwardBackendResponse(response);
  } catch (error) {
    console.error("Could not load source settings:", error);
    return Response.json({ error: "Source settings are unavailable" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await authorizeAdmin())) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const category = request.nextUrl.searchParams.get("category") ?? "";
    const filename = request.nextUrl.searchParams.get("filename") ?? "";
    const activateAfterIngestion = request.nextUrl.searchParams
      .get("activateAfterIngestion") ?? "false";
    const { baseUrl, adminToken } = getAdminBackendConfig();
    const query = new URLSearchParams({
      category,
      filename,
      activateAfterIngestion,
    });
    const response = await fetch(
      `${baseUrl}/service/admin/sources/upload?${query.toString()}`,
      {
        method: "POST",
        headers: {
          "content-type": request.headers.get("content-type")
            ?? "application/octet-stream",
          "x-admin-token": adminToken,
        },
        body: await request.arrayBuffer(),
        cache: "no-store",
      },
    );

    return forwardBackendResponse(response);
  } catch (error) {
    console.error("Could not upload source:", error);
    return Response.json({ error: "Source upload failed" }, { status: 503 });
  }
}

import { auth } from "../../auth";

export async function authorizeAdmin() {
  const session = await auth();
  const signedInEmail = session?.user?.email?.toLowerCase();
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();

  return Boolean(signedInEmail && adminEmail && signedInEmail === adminEmail);
}

export function getAdminBackendConfig() {
  const baseUrl = process.env.INTERNAL_API_URL;
  const adminToken = process.env.ADMIN_API_TOKEN;

  if (!baseUrl || !adminToken) {
    throw new Error("Admin backend connection is not configured");
  }

  return { baseUrl, adminToken };
}

export function forwardBackendResponse(response: Response) {
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}

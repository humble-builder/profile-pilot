import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  authorizeAdmin,
  forwardBackendResponse,
  getAdminBackendConfig,
} from "@/lib/adminAccess";

vi.mock("@/lib/adminAccess", () => ({
  authorizeAdmin: vi.fn(),
  forwardBackendResponse: vi.fn(),
  getAdminBackendConfig: vi.fn(),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const settingsRoutes = await import("@/app/api/admin/settings/route");
const sourceRoutes = await import("@/app/api/admin/sources/route");
const activationRoutes = await import("@/app/api/admin/sources/activate/route");

describe("frontend admin proxy routes", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(authorizeAdmin).mockResolvedValue(true);
    vi.mocked(getAdminBackendConfig).mockReturnValue({
      baseUrl: "http://backend.internal",
      adminToken: "server-only-token",
    });
    vi.mocked(forwardBackendResponse).mockImplementation((response) => response);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  });

  it("rejects requests before contacting the backend when the user is not admin", async () => {
    vi.mocked(authorizeAdmin).mockResolvedValue(false);
    const response = await settingsRoutes.GET();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards settings updates with the server-side admin token", async () => {
    const body = { chatModel: "mock-chat" };
    await settingsRoutes.PUT(new Request("http://frontend/api/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.internal/service/admin/settings",
      expect.objectContaining({
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-admin-token": "server-only-token",
        },
        body: JSON.stringify(body),
      }),
    );
  });

  it("forwards source listing and raw upload requests", async () => {
    await sourceRoutes.GET();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://backend.internal/service/admin/sources",
      expect.objectContaining({ headers: { "x-admin-token": "server-only-token" } }),
    );

    const rawBody = new TextEncoder().encode("profile");
    const request = {
      nextUrl: new URL("http://frontend/api/admin/sources?category=profile&filename=profile.txt&activateAfterIngestion=false"),
      headers: new Headers({ "content-type": "text/plain" }),
      arrayBuffer: async () => rawBody.buffer,
    };
    await sourceRoutes.POST(request as never);

    const [url, options] = fetchMock.mock.calls.at(-1)!;
    expect(url).toContain("/service/admin/sources/upload?");
    expect(url).toContain("filename=profile.txt");
    expect(options).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "x-admin-token": "server-only-token",
      },
    });
    expect(Array.from(new Uint8Array(options.body))).toEqual(Array.from(rawBody));
  });

  it("forwards revision activation and maps connection failures to 503", async () => {
    await activationRoutes.POST(new Request("http://frontend/api/admin/sources/activate", {
      method: "POST",
      body: JSON.stringify({ sourceId: "profile/a.txt", revisionId: "revision-2" }),
    }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://backend.internal/service/admin/sources/activate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sourceId: "profile/a.txt", revisionId: "revision-2" }),
      }),
    );

    fetchMock.mockRejectedValue(new Error("mock network failure"));
    const response = await activationRoutes.POST(new Request(
      "http://frontend/api/admin/sources/activate",
      { method: "POST", body: JSON.stringify({ sourceId: "a", revisionId: "b" }) },
    ));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Source activation failed" });
  });
});

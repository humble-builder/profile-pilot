import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activateSourceRevision,
  fetchRuntimeSettings,
  fetchSourceManifests,
  updateRuntimeSettings,
  uploadProfileSource,
} from "@/services/sourceAdminApi";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("source admin API client", () => {
  beforeEach(() => fetchMock.mockReset());

  it("reads source manifests and runtime settings without caching", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([{ sourceId: "profile/a.txt" }])))
      .mockResolvedValueOnce(new Response(JSON.stringify({ chatModel: "mock-chat" })));

    await expect(fetchSourceManifests()).resolves.toEqual([{ sourceId: "profile/a.txt" }]);
    await expect(fetchRuntimeSettings()).resolves.toEqual({ chatModel: "mock-chat" });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/admin/sources", { cache: "no-store" });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/admin/settings", { cache: "no-store" });
  });

  it("submits settings, raw files, and revision activation payloads", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true })));
    const settings = {
      chatModel: "mock-chat",
      embeddingModel: "mock-embedding",
      embeddingDimensions: null,
      embeddingBatchSize: 10,
      embeddingTimeoutMs: 1000,
      embeddingConfigHash: "hash",
    };
    const file = new File(["profile"], "profile.txt", { type: "text/plain" });

    await updateRuntimeSettings(settings);
    await uploadProfileSource(file, "profile", false);
    await activateSourceRevision("profile/profile.txt", "revision-2");

    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify(settings),
    });
    expect(fetchMock.mock.calls[1][0]).toContain("filename=profile.txt");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", body: file });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ sourceId: "profile/profile.txt", revisionId: "revision-2" }),
    });
  });

  it("surfaces backend error messages", async () => {
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ error: "Duplicate document" }),
      { status: 409 },
    ));
    await expect(fetchSourceManifests()).rejects.toThrow("Duplicate document");
  });
});

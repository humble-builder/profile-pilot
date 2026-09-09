import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProfileSettings from "@/components/ProfileSettings";
import {
  activateSourceRevision,
  fetchRuntimeSettings,
  fetchSourceManifests,
  updateRuntimeSettings,
  uploadProfileSource,
} from "@/services/sourceAdminApi";

vi.mock("@/services/sourceAdminApi", () => ({
  activateSourceRevision: vi.fn(),
  fetchRuntimeSettings: vi.fn(),
  fetchSourceManifests: vi.fn(),
  updateRuntimeSettings: vi.fn(),
  uploadProfileSource: vi.fn(),
}));

const settings = {
  chatModel: "gpt-chat",
  embeddingModel: "text-embedding-3-small",
  embeddingDimensions: 512,
  embeddingBatchSize: 100,
  embeddingTimeoutMs: 30000,
  embeddingConfigHash: "hash",
};
const stagedSource = {
  source: "profile.txt",
  sourceId: "profile/profile.txt",
  category: "profile",
  activeSourceRevision: "revision-1",
  latestSourceRevision: "revision-2",
  updateAvailable: true,
  lastUpdatedAt: 1,
  revisions: [],
};

describe("ProfileSettings", () => {
  beforeEach(() => {
    vi.mocked(fetchRuntimeSettings).mockResolvedValue(settings);
    vi.mocked(fetchSourceManifests).mockResolvedValue([stagedSource]);
    vi.mocked(updateRuntimeSettings).mockResolvedValue({
      settings,
      embeddingMigration: null,
    });
    vi.mocked(uploadProfileSource).mockResolvedValue({});
    vi.mocked(activateSourceRevision).mockResolvedValue({});
  });

  it("loads settings and saves only changed model values", async () => {
    render(<ProfileSettings onClose={vi.fn()} />);
    expect(await screen.findByRole("checkbox", { name: "Web search" })).toBeDisabled();
    const chatModel = await screen.findByLabelText("Chat model");
    fireEvent.change(chatModel, { target: { value: "new-chat-model" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateRuntimeSettings).toHaveBeenCalledWith({
      ...settings,
      chatModel: "new-chat-model",
    }));
    expect(uploadProfileSource).not.toHaveBeenCalled();
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
  });

  it("saves settings before uploading when both were submitted", async () => {
    const callOrder: string[] = [];
    vi.mocked(updateRuntimeSettings).mockImplementation(async (nextSettings) => {
      callOrder.push("settings");
      return { settings: nextSettings, embeddingMigration: null };
    });
    vi.mocked(uploadProfileSource).mockImplementation(async () => {
      callOrder.push("upload");
      return {};
    });
    render(<ProfileSettings onClose={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText("Chat model"), {
      target: { value: "new-chat-model" },
    });
    const file = new File(["profile"], "profile.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Document"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Settings saved and document uploaded.")).toBeInTheDocument();
    expect(callOrder).toEqual(["settings", "upload"]);
    expect(uploadProfileSource).toHaveBeenCalledWith(file, "profile", true);
  });

  it("reports a partial success when upload fails after settings save", async () => {
    vi.mocked(uploadProfileSource).mockRejectedValue(new Error("Mock upload failed"));
    render(<ProfileSettings onClose={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText("Chat model"), {
      target: { value: "new-chat-model" },
    });
    fireEvent.change(screen.getByLabelText("Document"), {
      target: { files: [new File(["profile"], "profile.txt")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Settings were saved. Mock upload failed")).toBeInTheDocument();
  });

  it("activates the latest staged source revision", async () => {
    render(<ProfileSettings onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Use latest revision" }));

    await waitFor(() => expect(activateSourceRevision).toHaveBeenCalledWith(
      stagedSource.sourceId,
      stagedSource.latestSourceRevision,
    ));
    expect(fetchSourceManifests).toHaveBeenCalledTimes(2);
  });
});

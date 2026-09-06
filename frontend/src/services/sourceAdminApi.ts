export interface SourceRevision {
  id: string;
  createdAt: number;
  lastActivatedAt: number | null;
  chunkCount: number;
}

export interface SourceManifest {
  source: string;
  sourceId: string;
  category: string;
  activeSourceRevision: string;
  latestSourceRevision: string;
  updateAvailable: boolean;
  lastUpdatedAt: number;
  revisions: SourceRevision[];
}

export interface RuntimeSettings {
  chatModel: string;
  embeddingModel: string;
  embeddingDimensions: number | null;
  embeddingBatchSize: number;
  embeddingTimeoutMs: number;
  embeddingConfigHash: string;
}

async function readApiResponse(response: Response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Source operation failed");
  }
  return data;
}

export async function fetchSourceManifests(): Promise<SourceManifest[]> {
  const response = await fetch("/api/admin/sources", { cache: "no-store" });
  return readApiResponse(response);
}

export async function fetchRuntimeSettings(): Promise<RuntimeSettings> {
  const response = await fetch("/api/admin/settings", { cache: "no-store" });
  return readApiResponse(response);
}

export async function updateRuntimeSettings(settings: RuntimeSettings) {
  const response = await fetch("/api/admin/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  });
  return readApiResponse(response) as Promise<{
    settings: RuntimeSettings;
    embeddingMigration: { migratedSourceCount: number } | null;
  }>;
}

export async function uploadProfileSource(
  file: File,
  category: string,
  activateAfterIngestion: boolean,
) {
  const query = new URLSearchParams({
    category,
    filename: file.name,
    activateAfterIngestion: String(activateAfterIngestion),
  });
  const response = await fetch(`/api/admin/sources?${query.toString()}`, {
    method: "POST",
    headers: {
      "content-type": file.type || "application/octet-stream",
    },
    body: file,
  });
  return readApiResponse(response);
}

export async function activateSourceRevision(sourceId: string, revisionId: string) {
  const response = await fetch("/api/admin/sources/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceId, revisionId }),
  });
  return readApiResponse(response);
}

"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  activateSourceRevision,
  fetchRuntimeSettings,
  fetchSourceManifests,
  RuntimeSettings,
  SourceManifest,
  updateRuntimeSettings,
  uploadProfileSource,
} from "@/services/sourceAdminApi";

const categories = ["profile", "capabilities", "hiring", "personal"];

export default function ProfileSettings({ onClose }: { onClose: () => void }) {
  const [sources, setSources] = useState<SourceManifest[]>([]);
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<RuntimeSettings | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("profile");
  const [activateAfterIngestion, setActivateAfterIngestion] = useState(true);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshSources = async () => {
    try {
      setError(null);
      setSources(await fetchSourceManifests());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load sources");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;

    Promise.all([fetchSourceManifests(), fetchRuntimeSettings()])
      .then(([manifests, runtimeSettings]) => {
        if (ignore) return;
        setError(null);
        setSources(manifests);
        setSettings(runtimeSettings);
        setSavedSettings(runtimeSettings);
      })
      .catch((requestError) => {
        if (ignore) return;
        setError(requestError instanceof Error
          ? requestError.message
          : "Could not load sources");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  const settingsChanged = Boolean(
    settings && savedSettings
    && JSON.stringify(settings) !== JSON.stringify(savedSettings)
  );

  const handleSubmit = async () => {
    if (!settings || (!settingsChanged && !file)) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    let settingsWereSaved = false;

    try {
      let activeSettings = settings;
      if (settingsChanged) {
        const result = await updateRuntimeSettings(settings);
        activeSettings = result.settings;
        setSettings(activeSettings);
        setSavedSettings(activeSettings);
        settingsWereSaved = true;
      }

      if (file) {
        await uploadProfileSource(file, category, activateAfterIngestion);
        setFile(null);
        await refreshSources();
      }
      setNotice(settingsWereSaved && file
        ? "Settings saved and document uploaded."
        : settingsWereSaved
          ? "Settings saved."
          : "Document uploaded.");
    } catch (requestError) {
      const message = requestError instanceof Error
        ? requestError.message
        : "Could not apply changes";
      setError(settingsWereSaved ? `Settings were saved. ${message}` : message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = async (source: SourceManifest) => {
    setSubmitting(true);
    setError(null);

    try {
      await activateSourceRevision(source.sourceId, source.latestSourceRevision);
      await refreshSources();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Activation failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20">
      <section className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Profile settings</h2>
            <p className="text-sm text-gray-500">Upload documents and manage active revisions.</p>
          </div>
          <button
            className="rounded p-2 text-gray-500 hover:bg-gray-100"
            onClick={onClose}
            type="button"
            title="Close settings"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Models
          </h3>
          <label className="block text-sm font-medium text-gray-700">
            Chat model
            <input
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
              disabled={!settings}
              value={settings?.chatModel ?? ""}
              onChange={(event) => settings && setSettings({
                ...settings,
                chatModel: event.target.value,
              })}
            />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Embedding model
            <input
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
              disabled={!settings}
              value={settings?.embeddingModel ?? ""}
              onChange={(event) => settings && setSettings({
                ...settings,
                embeddingModel: event.target.value,
              })}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-gray-700">
              Dimensions
              <input
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                disabled={!settings}
                min="1"
                placeholder="Model default"
                type="number"
                value={settings?.embeddingDimensions ?? ""}
                onChange={(event) => settings && setSettings({
                  ...settings,
                  embeddingDimensions: event.target.value
                    ? Number(event.target.value)
                    : null,
                })}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Batch size
              <input
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                disabled={!settings}
                max="2048"
                min="1"
                type="number"
                value={settings?.embeddingBatchSize ?? ""}
                onChange={(event) => settings && setSettings({
                  ...settings,
                  embeddingBatchSize: Number(event.target.value),
                })}
              />
            </label>
          </div>
          <label className="block text-sm font-medium text-gray-700">
            Embedding timeout (ms)
            <input
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
              disabled={!settings}
              min="1"
              type="number"
              value={settings?.embeddingTimeoutMs ?? ""}
              onChange={(event) => settings && setSettings({
                ...settings,
                embeddingTimeoutMs: Number(event.target.value),
              })}
            />
          </label>

          <div className="rounded border border-gray-200 bg-gray-50 p-3">
            <label className="flex items-center justify-between gap-3 text-sm font-medium text-gray-700">
              Web search
              <input
                aria-describedby="web-search-status"
                checked={false}
                disabled
                readOnly
                type="checkbox"
              />
            </label>
            <p className="mt-1 text-xs text-gray-500" id="web-search-status">
              Web search is not available in this release.
            </p>
          </div>

          <hr className="border-gray-200" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Document revision
          </h3>
          <label className="block text-sm font-medium text-gray-700">
            Category
            <select
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {categories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700">
            Document
            <input
              accept=".pdf,.docx,.txt"
              className="mt-1 block w-full text-sm"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              checked={activateAfterIngestion}
              onChange={(event) => setActivateAfterIngestion(event.target.checked)}
              type="checkbox"
            />
            Activate after successful ingestion
          </label>

          <button
            className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={(!file && !settingsChanged) || submitting || !settings}
            onClick={handleSubmit}
            type="button"
          >
            {submitting ? "Applying…" : "Save changes"}
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {notice && <p className="mt-4 text-sm text-green-700">{notice}</p>}

        <div className="mt-6 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Sources</h3>
          {loading ? (
            <p className="text-sm text-gray-500">Loading sources…</p>
          ) : sources.map((source) => (
            <div className="rounded-lg border border-gray-200 p-3" key={source.sourceId}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{source.source}</p>
                  <p className="text-xs text-gray-500">{source.category}</p>
                </div>
                {source.updateAvailable ? (
                  <button
                    className="shrink-0 rounded border border-green-600 px-3 py-1 text-xs font-medium text-green-700 disabled:opacity-50"
                    disabled={submitting}
                    onClick={() => handleActivate(source)}
                    type="button"
                  >
                    Use latest revision
                  </button>
                ) : (
                  <span className="text-xs font-medium text-green-700">Active</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

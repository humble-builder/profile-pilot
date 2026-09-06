import { SourceObject } from "@/types/chat";
import { PanelRightClose } from "lucide-react";
 interface Props {
    sources: SourceObject[];
    onClose: () => void;
}

export default function SourcePanel({ sources, onClose }: Props) {
  const visibleSources = sources.slice(0, 3);

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Sources</h2>
        <button
          className="flex h-8 w-8 items-center justify-center rounded border border-gray-300 text-gray-700 transition hover:bg-gray-100"
          onClick={onClose}
          type="button"
          title="Hide sources"
        >
          <PanelRightClose size={16} />
        </button>
      </div>
      {sources.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">
          No sources selected.
        </p>
      ) : (
          <ul className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {visibleSources.map((source) => (
                <li key={source.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    {source.type === "vector" ? (
                      <div className="truncate text-sm font-medium text-gray-900">
                        {source.source}
                      </div>
                    ) : (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-sm font-medium text-gray-900 underline"
                      >
                        {source.title}
                      </a>
                    )}
                </li>
              ))}
          </ul>
      )}
    </aside>
  );
}

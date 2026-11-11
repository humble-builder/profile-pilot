"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, Clock3, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";

type RequestEvent = {
  requestId: string;
  conversationId: string;
  createdAt: string;
  status: "success" | "error";
  durationMs: number;
  intent: string;
  plannedStrategy: string;
  contextMode: string;
  retrievalSignals: Record<string, boolean>;
  resultCounts: { vector: number; web: number };
  sourceCount: number;
  stageDurationsMs: Record<string, number>;
  failureStage?: string;
  errorType?: string;
};

type DashboardData = {
  range: { from: string; to: string };
  summary: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    successRate: number;
    averageDurationMs: number;
    p95DurationMs: number;
    requestsWithSources: number;
    requestsWithoutSources: number;
    strategyCounts: Record<string, number>;
    intentCounts: Record<string, number>;
  };
  requests: RequestEvent[];
};

const formatDuration = (duration: number) => duration >= 1000
  ? `${(duration / 1000).toFixed(2)}s`
  : `${duration}ms`;

const ranges = [
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 7 days", hours: 24 * 7 },
  { label: "Last 30 days", hours: 24 * 30 },
];

export default function ObservabilityDashboard() {
  const [rangeHours, setRangeHours] = useState(24);
  const [data, setData] = useState<DashboardData | null>(null);
  const [selected, setSelected] = useState<RequestEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const to = new Date();
    const from = new Date(to.getTime() - rangeHours * 60 * 60 * 1000);
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), limit: "100" });
    try {
      const response = await fetch(`/api/admin/observability?${query}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load dashboard");
      setData(payload);
      setSelected(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load dashboard");
    } finally {
      setLoading(false);
    }
  }, [rangeHours]);

  useEffect(() => { void refresh(); }, [refresh]);

  const summary = data?.summary;
  const strategyEntries = Object.entries(summary?.strategyCounts ?? {}).sort((a, b) => b[1] - a[1]);
  const maxStrategyCount = Math.max(1, ...strategyEntries.map(([, count]) => count));

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
        <div className="flex items-center gap-3">
          <Link href="/" aria-label="Back to chat" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ArrowLeft size={18} /></Link>
          <div><p className="font-semibold">ProfilePilot</p><p className="text-xs text-slate-500">Platform observability</p></div>
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Time range" value={rangeHours} onChange={(event) => setRangeHours(Number(event.target.value))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            {ranges.map((range) => <option key={range.hours} value={range.hours}>{range.label}</option>)}
          </select>
          <button onClick={() => void refresh()} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={15} />Refresh</button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <div><h1 className="text-2xl font-semibold tracking-tight">Observability</h1><p className="mt-1 text-sm text-slate-500">Understand request volume, response quality, and retrieval behavior.</p></div>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {loading && !data ? <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading request metrics…</div> : summary && <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Requests" value={summary.totalRequests.toLocaleString()} caption={`${summary.successfulRequests} successful`} icon={<Activity size={18} />} />
            <MetricCard label="Success rate" value={`${(summary.successRate * 100).toFixed(1)}%`} caption={`${summary.failedRequests} failed`} icon={<ShieldCheck size={18} />} />
            <MetricCard label="Avg response time" value={formatDuration(summary.averageDurationMs)} caption="Across selected period" icon={<Clock3 size={18} />} />
            <MetricCard label="p95 latency" value={formatDuration(summary.p95DurationMs)} caption="95% of requests at or below" icon={<TriangleAlert size={18} />} />
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="font-semibold">Response strategy</h2><p className="mb-5 mt-1 text-sm text-slate-500">Requests routed during this period</p>
              {strategyEntries.length ? <div className="space-y-4">{strategyEntries.map(([name, count]) => <div key={name}>
                <div className="mb-1 flex justify-between text-sm"><span className="capitalize text-slate-700">{name.replaceAll("_", " ")}</span><span className="tabular-nums text-slate-500">{count}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${(count / maxStrategyCount) * 100}%` }} /></div>
              </div>)}</div> : <EmptyState />}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="font-semibold">Source usage</h2><p className="mb-5 mt-1 text-sm text-slate-500">Requests with at least one source</p>
              <div className="space-y-5 pt-1">
                <UsageBar label="With sources" count={summary.requestsWithSources} total={summary.totalRequests} color="bg-teal-500" />
                <UsageBar label="Without sources" count={summary.requestsWithoutSources} total={summary.totalRequests} color="bg-slate-400" />
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="font-semibold">Recent requests</h2><p className="text-sm text-slate-500">Latest {data?.requests.length ?? 0} request records</p></div><span className="text-xs text-slate-400">Messages and document text are not shown</span></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{["Time", "Intent", "Strategy", "Sources", "Duration", "Status"].map((label) => <th key={label} className="px-5 py-3 font-medium">{label}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">{data?.requests.map((request) => <tr key={request.requestId} onClick={() => setSelected(request)} className={`cursor-pointer hover:bg-indigo-50/50 ${selected?.requestId === request.requestId ? "bg-indigo-50" : ""}`}>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{new Date(request.createdAt).toLocaleString()}</td><td className="px-5 py-3 capitalize">{request.intent.replaceAll("_", " ")}</td><td className="px-5 py-3 capitalize">{request.plannedStrategy.replaceAll("_", " ")}</td><td className="px-5 py-3">{request.sourceCount}</td><td className="px-5 py-3 tabular-nums">{formatDuration(request.durationMs)}</td><td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${request.status === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{request.status}</span></td>
                </tr>)}</tbody>
              </table>
              {!data?.requests.length && <div className="p-8 text-center text-sm text-slate-500">No requests in this time range.</div>}
            </div>
          </section>

          {selected && <section className="rounded-xl border border-indigo-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">Request details</h2><p className="mt-1 font-mono text-xs text-slate-500">{selected.requestId}</p></div><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">{selected.contextMode} context</span></div>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Intent" value={selected.intent} /><Detail label="Strategy" value={selected.plannedStrategy} /><Detail label="Vector results" value={String(selected.resultCounts.vector)} /><Detail label="Web results" value={String(selected.resultCounts.web)} />
              {Object.entries(selected.stageDurationsMs).map(([stage, duration]) => <Detail key={stage} label={stage.replaceAll("_", " ")} value={formatDuration(duration)} />)}
              {selected.failureStage && <Detail label="Failure stage" value={`${selected.failureStage}${selected.errorType ? ` · ${selected.errorType}` : ""}`} />}
            </div>
          </section>}
        </>}
      </div>
    </main>
  );
}

function MetricCard({ label, value, caption, icon }: { label: string; value: string; caption: string; icon: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between text-slate-500"><span className="text-sm">{label}</span>{icon}</div><p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-slate-500">{caption}</p></div>;
}

function UsageBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const percent = total ? Math.round((count / total) * 100) : 0;
  return <div><div className="mb-2 flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-slate-500">{count} · {percent}%</span></div><div className="h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${color}`} style={{ width: `${percent}%` }} /></div></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs capitalize text-slate-500">{label}</p><p className="mt-1 text-sm font-medium text-slate-800">{value}</p></div>;
}

function EmptyState() {
  return <p className="rounded-lg bg-slate-50 p-5 text-sm text-slate-500">No strategy data for this period.</p>;
}

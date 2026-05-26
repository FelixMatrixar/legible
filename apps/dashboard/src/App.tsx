import { useEffect, useState } from "react";
import { BatchPanel, PageReportPanel } from "./components/BatchPanel";
import { PipelineFlow } from "./components/PipelineFlow";
import { saveApiKey, useDashboard } from "./store";
import { useLive } from "./useLive";

function ApiKeyGate() {
  const [key, setKey] = useState("");
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <form
        className="w-full max-w-sm space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) saveApiKey(key);
        }}
      >
        <h1 className="text-xl font-bold text-slate-100">legible</h1>
        <p className="text-sm text-slate-400">
          Paste your API key (the INTERNAL_API_KEY the server was started with).
          It is stored only in this browser.
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="API key"
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
        />
        <button
          type="submit"
          className="w-full rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-white"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const unauthorized = useDashboard((s) => s.unauthorized);
  if (unauthorized) return <ApiKeyGate />;
  return <Dashboard />;
}

function Dashboard() {
  useLive();
  const batches = useDashboard((s) => s.batches);
  const selectedBatchId = useDashboard((s) => s.selectedBatchId);
  const selectBatch = useDashboard((s) => s.selectBatch);
  const loadBatches = useDashboard((s) => s.loadBatches);
  const liveEvents = useDashboard((s) => s.liveEvents);
  const wsConnected = useDashboard((s) => s.wsConnected);
  const detail = useDashboard((s) => s.batchDetail);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <h1 className="text-xl font-bold">legible</h1>
          <p className="text-xs text-slate-500">AI-legibility auditor</p>
        </div>
        <span className={`text-xs ${wsConnected ? "text-emerald-400" : "text-red-400"}`}>
          {wsConnected ? "● live" : "○ disconnected"}
        </span>
      </header>

      <main className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[16rem_1fr]">
        <aside>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Batches
          </h2>
          <div className="space-y-1">
            {batches.length === 0 && (
              <p className="text-sm text-slate-600">
                None yet — POST /api/batches to submit one.
              </p>
            )}
            {batches.map((b) => (
              <button
                key={b.id}
                onClick={() => void selectBatch(b.id)}
                className={`block w-full rounded-md px-3 py-2 text-left text-sm ${
                  b.id === selectedBatchId
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:bg-slate-900"
                }`}
              >
                <span className="block truncate">{b.name}</span>
                <span className="text-xs text-slate-500">
                  {b.status}
                  {b.summary ? ` · avg ${b.summary.avgScore}` : ""} · {b.environment}
                </span>
              </button>
            ))}
          </div>

          <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Activity
          </h2>
          <div className="space-y-1 text-xs text-slate-500">
            {liveEvents.slice(0, 12).map((e, i) => (
              <div key={i} className="truncate">
                <span className="text-slate-400">{e.type}</span>
                {e.url ? ` ${new URL(e.url).pathname}` : ""}
                {typeof e.score === "number" ? ` → ${e.score}` : ""}
              </div>
            ))}
          </div>
        </aside>

        <section className="space-y-6">
          <PipelineFlow />
          {detail?.batch.summary && detail.batch.summary.patterns.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Batch patterns
              </h2>
              {detail.batch.summary.patterns.slice(0, 5).map((p) => (
                <p key={p.templateId} className="text-sm text-slate-300">
                  <span className="font-mono text-xs text-slate-500">{p.templateId}</span> —{" "}
                  {p.pagesAffected} of {detail.batch.summary?.pageCount} pages
                </p>
              ))}
            </div>
          )}
          <BatchPanel />
        </section>
      </main>

      <PageReportPanel />
    </div>
  );
}

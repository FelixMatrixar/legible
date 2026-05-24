import { useDashboard } from "../store";

const severityStyle: Record<string, string> = {
  critical: "bg-red-500/20 text-red-300 border-red-500/40",
  major: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  minor: "bg-slate-500/20 text-slate-300 border-slate-500/40",
};

function ScoreBadge({ score, prior }: { score: number; prior: number | null }) {
  const color =
    score >= 80 ? "text-emerald-300" : score >= 50 ? "text-amber-300" : "text-red-300";
  return (
    <span className={`font-mono text-lg ${color}`}>
      {score}
      {prior !== null && (
        <span className="ml-1 text-xs text-slate-500">
          {score > prior ? "▲" : score < prior ? "▼" : "—"} was {prior}
        </span>
      )}
    </span>
  );
}

export function BatchPanel() {
  const detail = useDashboard((s) => s.batchDetail);
  const openPage = useDashboard((s) => s.openPage);
  if (!detail) return <div className="text-slate-500">No batch selected.</div>;

  const scoreByPage = new Map(detail.scores.map((s) => [s.page_id, s]));

  return (
    <div className="space-y-2">
      {detail.pages.map((page) => {
        const score = scoreByPage.get(page.id);
        return (
          <button
            key={page.id}
            onClick={() => void openPage(page.id)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-left hover:border-slate-600"
          >
            <span className="truncate text-sm text-slate-200">{page.url}</span>
            {score ? (
              <ScoreBadge score={score.score} prior={score.prior_score} />
            ) : (
              <span className="text-xs text-slate-500 animate-pulse">auditing…</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function PageReportPanel() {
  const report = useDashboard((s) => s.pageReport);
  const closePage = useDashboard((s) => s.closePage);
  if (!report) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-20 w-full max-w-xl overflow-y-auto border-l border-slate-700 bg-slate-950 p-6 shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="truncate text-lg font-semibold text-slate-100">{report.page.url}</h2>
        <button onClick={closePage} className="ml-4 text-slate-400 hover:text-white">
          ✕
        </button>
      </div>

      {report.score && (
        <div className="mb-6">
          <ScoreBadge score={report.score.score} prior={report.score.prior_score} />
          <span className="ml-2 text-sm text-slate-400">legibility score</span>
        </div>
      )}

      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Findings
      </h3>
      {report.findings.length === 0 && <p className="text-sm text-slate-500">None. Clean page.</p>}
      <div className="space-y-2">
        {report.findings.map((f) => (
          <div key={f.id} className={`rounded-md border px-3 py-2 text-sm ${severityStyle[f.severity]}`}>
            <span className="mr-2 font-mono text-xs uppercase">{f.severity}</span>
            {f.message}
          </div>
        ))}
      </div>

      <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Navigation goals
      </h3>
      {report.agentResults.length === 0 && (
        <p className="text-sm text-slate-500">No goals were configured for this page.</p>
      )}
      <div className="space-y-3">
        {report.agentResults.map((g, i) => (
          <div key={i} className="rounded-md border border-slate-800 bg-slate-900/60 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-200">{g.goal}</span>
              <span
                className={
                  g.outcome === "succeeded"
                    ? "text-emerald-300"
                    : g.outcome === "skipped"
                      ? "text-slate-400"
                      : "text-red-300"
                }
              >
                {g.outcome}
                {g.perception_mode === "visual-fallback" && " (visual fallback)"}
              </span>
            </div>
            {g.skipped_reason && <p className="mt-1 text-xs text-slate-500">{g.skipped_reason}</p>}
            {g.history.length > 0 && (
              <ol className="mt-2 space-y-1 text-xs text-slate-400">
                {g.history.map((h) => (
                  <li key={h.step} className="font-mono">
                    {h.step}. {h.action} [{h.perceptionMode}] → {h.result}
                  </li>
                ))}
              </ol>
            )}
            {g.teardown_outcome && (
              <p className="mt-1 text-xs text-slate-500">teardown: {g.teardown_outcome}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

import { useMemo } from "react";
import ReactFlow, { Background, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import { useDashboard } from "../store";

/** The architecture diagram, live: pages visualized moving through stages. */
export function PipelineFlow() {
  const detail = useDashboard((s) => s.batchDetail);
  const p = detail?.progress ?? {};
  const total = Number(p.total ?? 0);
  const structureDone = Number(p.structureDone ?? 0);
  const agentDone = Number(p.agentDone ?? 0);
  const scored = Number(p.scored ?? 0);

  const nodes: Node[] = useMemo(
    () => [
      stage("submit", 20, 120, `pages-to-audit\n${total} queued`),
      stage("structure", 240, 40, `structure-audit\n${structureDone}/${total}`),
      stage("agent", 240, 200, `agent-nav\n${agentDone}/${total}`),
      stage("scorer", 460, 120, `scorer\n${scored}/${total}`),
      stage("done", 660, 120, detail?.batch.status === "complete" ? "complete ✓" : "webhook\npending"),
    ],
    [total, structureDone, agentDone, scored, detail?.batch.status]
  );

  const edges: Edge[] = useMemo(() => {
    const active = total > 0 && scored < total;
    return [
      edge("e1", "submit", "structure", active),
      edge("e2", "submit", "agent", active),
      edge("e3", "structure", "scorer", active),
      edge("e4", "agent", "scorer", active),
      edge("e5", "scorer", "done", active),
    ];
  }, [total, scored]);

  return (
    <div className="h-72 rounded-lg border border-slate-800 bg-slate-900/60">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnDrag={false}
      >
        <Background color="#1e293b" gap={18} />
      </ReactFlow>
    </div>
  );
}

function stage(id: string, x: number, y: number, label: string): Node {
  return {
    id,
    position: { x, y },
    data: { label },
    style: {
      background: "#0f172a",
      color: "#e2e8f0",
      border: "1px solid #334155",
      borderRadius: 8,
      fontSize: 12,
      whiteSpace: "pre-line",
      width: 150,
      textAlign: "center",
    },
  };
}

function edge(id: string, source: string, target: string, animated: boolean): Edge {
  return { id, source, target, animated, style: { stroke: "#475569" } };
}

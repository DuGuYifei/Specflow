import "@xyflow/react/dist/style.css";
import "./styles.css";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node
} from "@xyflow/react";

const phaseZeroNodes: Node[] = [
  {
    id: "ticket",
    position: { x: 0, y: 120 },
    data: { label: "Ticket" },
    type: "input"
  },
  { id: "interview", position: { x: 210, y: 120 }, data: { label: "Interview" } },
  { id: "plan", position: { x: 420, y: 120 }, data: { label: "Plan" } },
  { id: "code-draft", position: { x: 630, y: 120 }, data: { label: "Code Draft" } },
  {
    id: "implementation-review",
    position: { x: 860, y: 120 },
    data: { label: "Implementation Review" }
  },
  { id: "repair-loop", position: { x: 860, y: 250 }, data: { label: "Repair Loop" } },
  {
    id: "final-patch",
    position: { x: 1110, y: 120 },
    data: { label: "Final Patch" },
    type: "output"
  }
];

const controlEdge = {
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { strokeWidth: 2, stroke: "#315c72" }
};

const reviewEdge = {
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { strokeWidth: 2, stroke: "#c45d4a", strokeDasharray: "6 4" },
  labelStyle: { fill: "#7a2e21", fontWeight: 600 }
};

const phaseZeroEdges: Edge[] = [
  { id: "ticket-interview", source: "ticket", target: "interview", ...controlEdge },
  { id: "interview-plan", source: "interview", target: "plan", ...controlEdge },
  { id: "plan-code-draft", source: "plan", target: "code-draft", ...controlEdge },
  {
    id: "code-draft-review",
    source: "code-draft",
    target: "implementation-review",
    ...controlEdge
  },
  {
    id: "review-repair",
    source: "implementation-review",
    target: "repair-loop",
    label: "review loop",
    ...reviewEdge
  },
  {
    id: "repair-review",
    source: "repair-loop",
    target: "implementation-review",
    label: "repair",
    ...reviewEdge
  },
  {
    id: "review-final-patch",
    source: "implementation-review",
    target: "final-patch",
    ...controlEdge
  }
];

export function WorkflowPanel() {
  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Continuous Coding</p>
          <h1>Specflow</h1>
        </div>
        <p className="phase">Local-first foundation</p>
      </header>
      <section className="graph-surface" aria-label="Static local workflow graph">
        {/* TODO: Bind nodes to local runtime state after the runtime leaves placeholder mode. */}
        <ReactFlow
          nodes={phaseZeroNodes}
          edges={phaseZeroEdges}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
        >
          <Background color="#c8d6d0" gap={20} />
          <Controls showInteractive={false} />
          <MiniMap pannable={false} zoomable={false} />
        </ReactFlow>
      </section>
    </main>
  );
}

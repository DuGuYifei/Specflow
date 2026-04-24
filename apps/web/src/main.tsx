import React from 'react';
import ReactDOM from 'react-dom/client';
import { Background, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';

const nodes: Node[] = [
  { id: 'ticket', position: { x: 0, y: 60 }, data: { label: 'ticket' }, type: 'input' },
  { id: 'interview', position: { x: 180, y: 60 }, data: { label: 'interview' } },
  { id: 'plan', position: { x: 360, y: 60 }, data: { label: 'plan' } },
  { id: 'code-draft', position: { x: 540, y: 60 }, data: { label: 'code draft' } },
  { id: 'implementation-review', position: { x: 760, y: 60 }, data: { label: 'implementation review' } },
  { id: 'repair-loop', position: { x: 980, y: 60 }, data: { label: 'repair loop' } },
  { id: 'final-patch', position: { x: 1180, y: 60 }, data: { label: 'final patch' }, type: 'output' }
];

const edges: Edge[] = [
  { id: 'e1', source: 'ticket', target: 'interview', label: 'control_flow' },
  { id: 'e2', source: 'interview', target: 'plan', label: 'control_flow' },
  { id: 'e3', source: 'plan', target: 'code-draft', label: 'control_flow' },
  { id: 'e4', source: 'code-draft', target: 'implementation-review', label: 'review_loop' },
  { id: 'e5', source: 'implementation-review', target: 'repair-loop', label: 'review_loop' },
  { id: 'e6', source: 'repair-loop', target: 'final-patch', label: 'control_flow' }
];

function App(): React.JSX.Element {
  return (
    <main className="app-shell">
      <h1>Specflow Phase 0</h1>
      <p>
        Continuous Coding placeholder graph: ticket → interview → plan → code draft → implementation review
        → repair loop → final patch.
      </p>
      {/* TODO(phase-1): bind graph nodes and edges to server-backed workflow definitions. */}
      <div className="graph-panel">
        <ReactFlow nodes={nodes} edges={edges} fitView>
          <Background />
          <MiniMap />
          <Controls />
        </ReactFlow>
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

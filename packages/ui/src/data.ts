import type { Session, Workflow, Run, WorkflowNode, Edge } from './types';

export interface SpecflowData {
  nodes: WorkflowNode[];
  edges: Edge[];
  sessions: Session[];
  workflows: Workflow[];
  runs: Run[];
}

const sessions: Session[] = [
  { id: 's1', name: 'parser',    agentServerId: 'claude-acp' },
  { id: 's2', name: 'builder',   agentServerId: 'claude-acp' },
  { id: 's3', name: 'reviewer',  agentServerId: 'codex-acp' },
  { id: 's4', name: 'interview', agentServerId: 'claude-acp' },
  { id: 's5', name: 'plan-code', agentServerId: 'claude-acp' },
];

const nodes: WorkflowNode[] = [
  { id: 'n1',  kind: 'step', num: '01',   x: 60,   y: 240, w: 230,
    title: 'Ticket',
    prompt: 'Capture the incoming ticket — title, description, attached screenshots.',
    images: [{ path: '.aflow/.specflow/assets/example-code-frontend-flow/images/ticket.png', label: 'ticket.png', mimeType: 'image/png' }], paths: ['/issues/PROD-2841'],
    sessionId: 's1', locked: true },

  { id: 'n2a', kind: 'step', num: '02·a', x: 340,  y: 80,  w: 220,
    title: 'Parse image components',
    prompt: 'Vision pass over the ticket screenshot. Identify named components and regions.',
    paths: ['design/figma-export.json'],
    sessionId: 's1' },
  { id: 'n2b', kind: 'step', num: '02·b', x: 600,  y: 80,  w: 220,
    title: 'Generate HTML',
    prompt: 'Synthesize draft HTML reproducing <specflow_component_tree> using the project DS.',
    paths: ['src/components/'],
    sessionId: 's2' },
  { id: 'n2c', kind: 'step', num: '02·c', x: 860,  y: 80,  w: 220,
    title: 'Agent reviews component',
    prompt: 'Reviewer agent diffs <specflow_draft_html> against the source image and surfaces visual regressions.',
    sessionId: 's3' },

  { id: 'g1', kind: 'gate', num: 'G1', x: 1130, y: 100, w: 200,
    title: 'Component review verdict',
    decisionCriteria: 'Decide whether the generated component faithfully matches the ticket screenshot. Choose pass when visual regressions are absent and intent is preserved; rework when meaningful divergence remains.',
    branches: [
      { id: 'pass', label: 'pass' },
      { id: 'rework', label: 'rework' },
      { id: 'fail', label: 'fail' },
    ], },

  { id: 'n3a', kind: 'step', num: '03·a', x: 340, y: 360, w: 230,
    title: 'Interview · feature & task',
    prompt: 'Using <specflow_review_findings>, run targeted Q&A clarifying feature scope and the specific task being requested.',
    sessionId: 's4', locked: true },
  { id: 'n3b', kind: 'step', num: '03·b', x: 610, y: 360, w: 230,
    title: 'Interview · edge cases',
    prompt: 'Probe for exception cases, failure modes, and boundary behavior.',
    sessionId: 's4', locked: true },
  { id: 'n3c', kind: 'step', num: '03·c', x: 880, y: 360, w: 230,
    title: 'Summarize interview',
    prompt: 'Consolidate Q&A into a structured spec brief.',
    sessionId: 's4', locked: true },

  { id: 'n4a', kind: 'step', num: '04·a', x: 340, y: 600, w: 220,
    title: 'Plan',
    prompt: 'Break <specflow_spec_brief> into ordered, file-scoped implementation steps with explicit acceptance.',
    sessionId: 's5' },
  { id: 'n4b', kind: 'step', num: '04·b', x: 600, y: 600, w: 220,
    title: 'Code',
    prompt: 'Author implementation against the plan. Touches only declared files.',
    paths: ['src/', 'tests/'],
    sessionId: 's5' },
  { id: 'n4c', kind: 'step', num: '04·c', x: 860, y: 600, w: 220,
    title: 'Review',
    prompt: 'Review <specflow_diff>: run tests, lint, type-check, verify acceptance.',
    sessionId: 's3' },

  { id: 'g2', kind: 'gate', num: 'G2', x: 1130, y: 620, w: 200,
    title: 'Implementation verdict',
    decisionCriteria: 'Decide whether implementation passes review. Pass when tests, lint, types green and acceptance criteria met; rework when fixable; replan when scope or approach was wrong.',
    branches: [
      { id: 'pass', label: 'pass' },
      { id: 'rework', label: 'rework' },
      { id: 'replan', label: 'replan' },
    ], },

  { id: 'end1', kind: 'end', num: 'END', x: 1410, y: 640, w: 140, title: 'Done', sessionId: null },
];

const edges: Edge[] = [
  { id: 'e1',  from: 'n1',  to: 'n2a' },
  { id: 'e2',  from: 'n2a', to: 'n2b', transmit: true, outputTag: 'component_tree', handoffPrompt: 'Forward the parsed component tree as JSON, preserving nesting.' },
  { id: 'e3',  from: 'n2b', to: 'n2c', transmit: true, outputTag: 'draft_html', handoffPrompt: 'Send the generated HTML draft for visual review.' },
  { id: 'e4',  from: 'n2c', to: 'g1' },

  { id: 'e5',  from: 'g1',  to: 'n3a', branch: 'pass', transmit: true, outputTag: 'review_findings', handoffPrompt: 'Summarize review findings for the interview step.' },
  { id: 'e6',  from: 'g1',  to: 'n2b', branch: 'rework', loopback: true },
  { id: 'e7',  from: 'g1',  to: 'n2a', branch: 'fail',   loopback: true },

  { id: 'e8',  from: 'n3a', to: 'n3b' },
  { id: 'e9',  from: 'n3b', to: 'n3c' },
  { id: 'e10', from: 'n3c', to: 'n4a', transmit: true, outputTag: 'spec_brief', handoffPrompt: 'Hand the final interview brief to planning.' },

  { id: 'e11', from: 'n4a', to: 'n4b' },
  { id: 'e12', from: 'n4b', to: 'n4c', transmit: true, outputTag: 'diff', handoffPrompt: 'Forward the resulting diff plus test outputs for review.' },
  { id: 'e13', from: 'n4c', to: 'g2' },

  { id: 'e14', from: 'g2',  to: 'end1', branch: 'pass' },
  { id: 'e15', from: 'g2',  to: 'n4b',  branch: 'rework', loopback: true },
  { id: 'e16', from: 'g2',  to: 'n4a',  branch: 'replan', loopback: true },
];

const workflows: Workflow[] = [
  { id: 'example-code-frontend-flow', name: 'Frontend ticket flow', meta: '11 nodes', active: true, runs: 14 },
  { id: 'wf2', name: 'Backend bugfix flow',  meta: '7 nodes',               runs: 22 },
  { id: 'wf3', name: 'Design polish loop',   meta: '5 nodes',               runs: 6  },
  { id: 'wf4', name: 'Migration playbook',   meta: '13 nodes',              runs: 3  },
  { id: 'wf5', name: 'A11y audit',           meta: '8 nodes',               runs: 9  },
];

const runs: Run[] = [
  { id: 'r12', label: 'Run #248', ticket: 'PROD-2841 · Settings empty state',
    status: 'running', activeNode: 'n4b', progress: 'plan ✓  ·  code …',
    time: '14:02 · today', duration: '00:04:21', agent: 'claude-code', active: true },
  { id: 'r11', label: 'Run #247', ticket: 'PROD-2840 · Trial banner copy',
    status: 'success', time: '11:14 · today', duration: '00:08:49', agent: 'codex' },
  { id: 'r10', label: 'Run #246', ticket: 'PROD-2837 · Avatar dropdown bug',
    status: 'error', time: 'yesterday · 18:22', duration: '00:02:17', agent: 'claude-code',
    errorMsg: 'gate G2 → replan exhausted (max 5)' },
  { id: 'r9',  label: 'Run #245', ticket: 'PROD-2832 · Onboarding step 3',
    status: 'success', time: 'yesterday · 09:40', duration: '00:11:02', agent: 'claude-code' },
  { id: 'r8',  label: 'Run #244', ticket: 'PROD-2828 · Filter chips alignment',
    status: 'success', time: '2d ago', duration: '00:06:12', agent: 'codex' },
  { id: 'r7',  label: 'Run #243', ticket: 'PROD-2825 · Empty inbox illustration',
    status: 'success', time: '2d ago', duration: '00:09:33', agent: 'claude-code' },
  { id: 'r6',  label: 'Run #242', ticket: 'PROD-2820 · Sidebar collapse anim',
    status: 'success', time: '3d ago', duration: '00:05:48', agent: 'codex' },
];

export const SPECFLOW_DATA: SpecflowData = { nodes, edges, sessions, workflows, runs };

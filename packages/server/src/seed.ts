import type { CanvasDoc } from "./canvas-doc";

export const UNCONFIGURED_AGENT_SERVER_ID = "unconfigured";

export const SEED_CANVAS_DOCS: CanvasDoc[] = [
  {
    id: "wf1",
    name: "Frontend ticket flow",
    sessions: [
      { id: "parser", name: "parser", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
      { id: "builder", name: "builder", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
      { id: "reviewer", name: "reviewer", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
      { id: "interview", name: "interview", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
      { id: "plan-code", name: "plan-code", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
    ],
    nodes: [
      { kind: "step", id: "n1",  num: "01",   x: 60,   y: 240, w: 230,
        title: "Ticket",
        prompt: "Capture the incoming ticket — title, description, attached screenshots.",
        images: [{ path: ".specflow/assets/wf1/images/ticket.png", label: "ticket.png", mimeType: "image/png" }], paths: ["/issues/PROD-2841"],
        sessionId: "parser", locked: true },

      { kind: "step", id: "n2a", num: "02·a", x: 340,  y: 80,  w: 220,
        title: "Parse image components",
        prompt: "Vision pass over the ticket screenshot. Identify named components and regions.",
        paths: ["design/figma-export.json"],
        sessionId: "parser" },
      { kind: "step", id: "n2b", num: "02·b", x: 600,  y: 80,  w: 220,
        title: "Generate HTML",
        prompt: "Synthesize draft HTML reproducing <specflow_component_tree> using the project DS.",
        paths: ["src/components/"],
        sessionId: "builder" },
      { kind: "step", id: "n2c", num: "02·c", x: 860,  y: 80,  w: 220,
        title: "Agent reviews component",
        prompt: "Reviewer agent diffs <specflow_draft_html> against the source image and surfaces visual regressions.",
        sessionId: "reviewer" },

      { kind: "gate", id: "g1", num: "G1", x: 1130, y: 100, w: 200,
        title: "Component review verdict",
        decisionCriteria: "Decide whether the generated component faithfully matches the ticket screenshot. Choose pass when visual regressions are absent and intent is preserved; rework when meaningful divergence remains.",
        branches: [
          { id: "pass", label: "pass" },
          { id: "rework", label: "rework" },
          { id: "fail", label: "fail" },
        ], },

      { kind: "step", id: "n3a", num: "03·a", x: 340, y: 360, w: 230,
        title: "Interview · feature & task",
        prompt: "Using <specflow_review_findings>, run targeted Q&A clarifying feature scope and the specific task being requested.",
        sessionId: "interview", locked: true },
      { kind: "step", id: "n3b", num: "03·b", x: 610, y: 360, w: 230,
        title: "Interview · edge cases",
        prompt: "Probe for exception cases, failure modes, and boundary behavior.",
        sessionId: "interview", locked: true },
      { kind: "step", id: "n3c", num: "03·c", x: 880, y: 360, w: 230,
        title: "Summarize interview",
        prompt: "Consolidate Q&A into a structured spec brief.",
        sessionId: "interview", locked: true },

      { kind: "step", id: "n4a", num: "04·a", x: 340, y: 600, w: 220,
        title: "Plan",
        prompt: "Break <specflow_spec_brief> into ordered, file-scoped implementation steps with explicit acceptance.",
        sessionId: "plan-code" },
      { kind: "step", id: "n4b", num: "04·b", x: 600, y: 600, w: 220,
        title: "Code",
        prompt: "Author implementation against the plan. Touches only declared files.",
        paths: ["src/", "tests/"],
        sessionId: "plan-code" },
      { kind: "step", id: "n4c", num: "04·c", x: 860, y: 600, w: 220,
        title: "Review",
        prompt: "Review <specflow_diff>: run tests, lint, type-check, verify acceptance.",
        sessionId: "reviewer" },

      { kind: "gate", id: "g2", num: "G2", x: 1130, y: 620, w: 200,
        title: "Implementation verdict",
        decisionCriteria: "Decide whether implementation passes review. Pass when tests, lint, types green and acceptance criteria met; rework when fixable; replan when scope or approach was wrong.",
        branches: [
          { id: "pass", label: "pass" },
          { id: "rework", label: "rework" },
          { id: "replan", label: "replan" },
        ], },

      { kind: "end", id: "end1", num: "END", x: 1410, y: 640, w: 140, title: "Done", sessionId: null },
    ],
    edges: [
      { id: "e1",  from: "n1",  to: "n2a" },
      { id: "e2",  from: "n2a", to: "n2b", transmit: true, outputTag: "component_tree", handoffPrompt: "Forward the parsed component tree as JSON, preserving nesting." },
      { id: "e3",  from: "n2b", to: "n2c", transmit: true, outputTag: "draft_html", handoffPrompt: "Send the generated HTML draft for visual review." },
      { id: "e4",  from: "n2c", to: "g1" },

      { id: "e5",  from: "g1",  to: "n3a", branch: "pass", transmit: true, outputTag: "review_findings", handoffPrompt: "Summarize review findings for the interview step." },
      { id: "e6",  from: "g1",  to: "n2b", branch: "rework", loopback: true },
      { id: "e7",  from: "g1",  to: "n2a", branch: "fail",   loopback: true },

      { id: "e8",  from: "n3a", to: "n3b" },
      { id: "e9",  from: "n3b", to: "n3c" },
      { id: "e10", from: "n3c", to: "n4a", transmit: true, outputTag: "spec_brief", handoffPrompt: "Hand the final interview brief to planning." },

      { id: "e11", from: "n4a", to: "n4b" },
      { id: "e12", from: "n4b", to: "n4c", transmit: true, outputTag: "diff", handoffPrompt: "Forward the resulting diff plus test outputs for review." },
      { id: "e13", from: "n4c", to: "g2" },

      { id: "e14", from: "g2",  to: "end1", branch: "pass" },
      { id: "e15", from: "g2",  to: "n4b",  branch: "rework", loopback: true },
      { id: "e16", from: "g2",  to: "n4a",  branch: "replan", loopback: true },
    ],
  },
];

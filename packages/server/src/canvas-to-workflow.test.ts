import { describe, expect, it } from "bun:test";
import { canvasToWorkflow } from "./canvas-to-workflow";
import type { CanvasDoc } from "./canvas-doc";

// Minimal seed canvas matching the data.ts shape (wf1)
const wf1Canvas: CanvasDoc = {
  id: "wf1",
  name: "Frontend ticket flow",
  sessions: [
    { id: "s1", name: "parser", agentServerId: "claude-acp" },
    { id: "s2", name: "builder", agentServerId: "claude-acp" },
    { id: "s3", name: "reviewer", agentServerId: "codex-acp" },
    { id: "s4", name: "interview", agentServerId: "claude-acp" },
    { id: "s5", name: "plan-code", agentServerId: "claude-acp" },
  ],
  nodes: [
    { kind: "step", id: "n1",  num: "01",   x: 60,   y: 240, w: 230, title: "Ticket",  prompt: "Capture ticket.", sessionId: "s1", locked: true },
    { kind: "step", id: "n2a", num: "02·a", x: 340,  y: 80,  w: 220, title: "Parse",   prompt: "Parse components.", sessionId: "s1" },
    { kind: "step", id: "n2b", num: "02·b", x: 600,  y: 80,  w: 220, title: "HTML",    prompt: "Generate HTML.", sessionId: "s2" },
    { kind: "step", id: "n2c", num: "02·c", x: 860,  y: 80,  w: 220, title: "Review",  prompt: "Review component.", sessionId: "s3" },
    { kind: "gate", id: "g1",  num: "G1",   x: 1130, y: 100, w: 200, title: "G1 verdict", decisionCriteria: "Decide outcome.",
      branches: [{ id: "pass", label: "pass" }, { id: "rework", label: "rework" }, { id: "fail", label: "fail" }] },
    { kind: "step", id: "n3a", num: "03·a", x: 340,  y: 360, w: 230, title: "Interview", prompt: "Interview.", sessionId: "s4" },
    { kind: "step", id: "n3b", num: "03·b", x: 610,  y: 360, w: 230, title: "Edge cases", prompt: "Probe edge cases.", sessionId: "s4" },
    { kind: "step", id: "n3c", num: "03·c", x: 880,  y: 360, w: 230, title: "Summarize", prompt: "Summarize.", sessionId: "s4" },
    { kind: "step", id: "n4a", num: "04·a", x: 340,  y: 600, w: 220, title: "Plan",  prompt: "Plan.", sessionId: "s5" },
    { kind: "step", id: "n4b", num: "04·b", x: 600,  y: 600, w: 220, title: "Code",  prompt: "Code.", sessionId: "s5" },
    { kind: "step", id: "n4c", num: "04·c", x: 860,  y: 600, w: 220, title: "Review2", prompt: "Self-review.", sessionId: "s3" },
    { kind: "gate", id: "g2",  num: "G2",   x: 1130, y: 620, w: 200, title: "G2 verdict", decisionCriteria: "Implementation verdict.",
      branches: [{ id: "pass", label: "pass" }, { id: "rework", label: "rework" }, { id: "replan", label: "replan" }] },
    { kind: "end", id: "end1", num: "END", x: 1410, y: 640, w: 140, title: "Done", sessionId: null },
  ],
  edges: [
    { id: "e1",  from: "n1",  to: "n2a" },
    { id: "e2",  from: "n2a", to: "n2b", transmit: true, outputTag: "component_tree", handoffPrompt: "Forward component tree." },
    { id: "e3",  from: "n2b", to: "n2c", transmit: true, outputTag: "draft_html", handoffPrompt: "Send HTML draft." },
    { id: "e4",  from: "n2c", to: "g1" },
    { id: "e5",  from: "g1",  to: "n3a", branch: "pass", transmit: true, outputTag: "review_findings", handoffPrompt: "Summarize findings." },
    { id: "e6",  from: "g1",  to: "n2b", branch: "rework", loopback: true },
    { id: "e7",  from: "g1",  to: "n2a", branch: "fail",   loopback: true },
    { id: "e8",  from: "n3a", to: "n3b" },
    { id: "e9",  from: "n3b", to: "n3c" },
    { id: "e10", from: "n3c", to: "n4a", transmit: true, outputTag: "spec_brief", handoffPrompt: "Hand brief." },
    { id: "e11", from: "n4a", to: "n4b" },
    { id: "e12", from: "n4b", to: "n4c", transmit: true, outputTag: "diff", handoffPrompt: "Forward diff." },
    { id: "e13", from: "n4c", to: "g2" },
    { id: "e14", from: "g2",  to: "end1", branch: "pass" },
    { id: "e15", from: "g2",  to: "n4b",  branch: "rework", loopback: true },
    { id: "e16", from: "g2",  to: "n4a",  branch: "replan", loopback: true },
  ],
};

describe("canvasToWorkflow", () => {
  it("creates external agents from canvas sessions plus default fallback", () => {
    const wf = canvasToWorkflow(wf1Canvas);
    expect(wf.agents.map((a) => a.id).sort()).toEqual([
      "agent-server-claude-acp",
      "agent-server-codex-acp",
    ]);
  });

  it("preserves all 5 sessions bound to their selected agent server", () => {
    const wf = canvasToWorkflow(wf1Canvas);
    expect(wf.sessions).toHaveLength(5);
    expect(wf.sessions.find((s) => s.id === "s1")?.agentId).toBe("agent-server-claude-acp");
    expect(wf.sessions.find((s) => s.id === "s3")?.agentId).toBe("agent-server-codex-acp");
  });

  it("drops the end node, keeps 12 runtime nodes", () => {
    const wf = canvasToWorkflow(wf1Canvas);
    expect(wf.nodes).toHaveLength(12);
    expect(wf.nodes.every((n) => n.kind !== "end" as string)).toBe(true);
  });

  it("drops 4 loopback edges + 1 edge to end = 11 runtime edges", () => {
    const wf = canvasToWorkflow(wf1Canvas);
    expect(wf.edges).toHaveLength(11);
  });

  it("same-session edges become trigger edges with no explicit transfer", () => {
    const wf = canvasToWorkflow(wf1Canvas);
    const e1 = wf.edges.find((e) => e.id === "e1");
    expect(e1?.kind).toBe("trigger");
  });

  it("cross-session tagged edge becomes tagged-output", () => {
    const wf = canvasToWorkflow(wf1Canvas);
    const e2 = wf.edges.find((e) => e.id === "e2");
    expect(e2?.kind).toBe("tagged-output");
    if (e2?.kind === "tagged-output") {
      expect(e2.outputTag.identifier).toBe("component_tree");
      expect(e2.outputTag.promptReference).toBe("specflow_component_tree");
      expect(e2.handoff?.promptTemplate.template).toBe("Forward component tree.");
    }
  });

  it("agent nodes use the agent server selected on their session", () => {
    const wf = canvasToWorkflow(wf1Canvas);
    const review = wf.nodes.find((n) => n.id === "n2c");
    expect(review?.kind).toBe("agent");
    if (review?.kind === "agent") {
      expect(review.agentId).toBe("agent-server-codex-acp");
      expect(review.sessionId).toBe("s3");
    }
  });

  it("gate input has no transfer configuration", () => {
    const wf = canvasToWorkflow(wf1Canvas);
    expect(wf.edges.find((e) => e.id === "e4")?.kind).toBe("gate-input");
  });

  it("gate output applies transfer rules against the step before the gate", () => {
    const wf = canvasToWorkflow(wf1Canvas);
    const e5 = wf.edges.find((e) => e.id === "e5");
    expect(e5?.kind).toBe("tagged-output");
    expect(e5?.sourcePortId).toBe("pass");
    if (e5?.kind === "tagged-output") {
      expect(e5.outputTag.promptReference).toBe("specflow_review_findings");
    }
  });
});

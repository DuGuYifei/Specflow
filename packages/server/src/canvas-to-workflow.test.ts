import { describe, expect, it } from "bun:test";
import { canvasToWorkflow, MOCK_AGENT_ID } from "./canvas-to-workflow";
import type { CanvasDoc } from "./canvas-doc";

// Minimal seed canvas matching the data.ts shape (wf1)
const wf1Canvas: CanvasDoc = {
  id: "wf1",
  name: "Frontend ticket flow",
  sessions: [
    { id: "s1", name: "parser",   color: "oklch(0.78 0.13 45)",  agent: "claude-code" },
    { id: "s2", name: "builder",  color: "oklch(0.74 0.13 145)", agent: "claude-code" },
    { id: "s3", name: "reviewer", color: "oklch(0.74 0.13 230)", agent: "codex" },
    { id: "s4", name: "interview",color: "oklch(0.74 0.13 300)", agent: "claude-code" },
    { id: "s5", name: "plan-code",color: "oklch(0.78 0.13 80)",  agent: "claude-code" },
  ],
  nodes: [
    { kind: "step", id: "n1",  num: "01",   x: 60,   y: 240, w: 230, title: "Ticket",  desc: "Capture ticket.", sessionId: "s1", updateDoc: false, locked: true },
    { kind: "step", id: "n2a", num: "02·a", x: 340,  y: 80,  w: 220, title: "Parse",   desc: "Parse components.", sessionId: "s1", updateDoc: false },
    { kind: "step", id: "n2b", num: "02·b", x: 600,  y: 80,  w: 220, title: "HTML",    desc: "Generate HTML.", sessionId: "s2", updateDoc: true },
    { kind: "step", id: "n2c", num: "02·c", x: 860,  y: 80,  w: 220, title: "Review",  desc: "Review component.", sessionId: "s3", updateDoc: false },
    { kind: "gate", id: "g1",  num: "G1",   x: 1130, y: 100, w: 200, title: "G1 verdict", gateDesc: "Decide outcome.", sessionId: "s3",
      branches: [{ id: "pass", label: "pass", color: "oklch(0.62 0.11 145)" }, { id: "rework", label: "rework", color: "oklch(0.72 0.13 80)" }, { id: "fail", label: "fail", color: "oklch(0.58 0.16 25)" }] },
    { kind: "step", id: "n3a", num: "03·a", x: 340,  y: 360, w: 230, title: "Interview", desc: "Interview.", sessionId: "s4", updateDoc: true },
    { kind: "step", id: "n3b", num: "03·b", x: 610,  y: 360, w: 230, title: "Edge cases", desc: "Probe edge cases.", sessionId: "s4", updateDoc: true },
    { kind: "step", id: "n3c", num: "03·c", x: 880,  y: 360, w: 230, title: "Summarize", desc: "Summarize.", sessionId: "s4", updateDoc: true },
    { kind: "step", id: "n4a", num: "04·a", x: 340,  y: 600, w: 220, title: "Plan",  desc: "Plan.", sessionId: "s5", updateDoc: true },
    { kind: "step", id: "n4b", num: "04·b", x: 600,  y: 600, w: 220, title: "Code",  desc: "Code.", sessionId: "s5", updateDoc: true },
    { kind: "step", id: "n4c", num: "04·c", x: 860,  y: 600, w: 220, title: "Review2", desc: "Self-review.", sessionId: "s3", updateDoc: false },
    { kind: "gate", id: "g2",  num: "G2",   x: 1130, y: 620, w: 200, title: "G2 verdict", gateDesc: "Implementation verdict.", sessionId: "s3",
      branches: [{ id: "pass", label: "pass", color: "oklch(0.62 0.11 145)" }, { id: "rework", label: "rework", color: "oklch(0.72 0.13 80)" }, { id: "replan", label: "replan", color: "oklch(0.62 0.13 230)" }] },
    { kind: "end", id: "end1", num: "END", x: 1410, y: 640, w: 140, title: "Done", sessionId: null },
  ],
  edges: [
    { id: "e1",  from: "n1",  to: "n2a", tag: "ticket",          prompt: "Pass ticket.",        sameSession: true },
    { id: "e2",  from: "n2a", to: "n2b", tag: "component_tree",  prompt: "Forward component tree." },
    { id: "e3",  from: "n2b", to: "n2c", tag: "draft_html",      prompt: "Send HTML draft." },
    { id: "e4",  from: "n2c", to: "g1",  tag: "review_findings", prompt: "Forward findings.",   sameSession: true },
    { id: "e5",  from: "g1",  to: "n3a", branch: "pass" },
    { id: "e6",  from: "g1",  to: "n2b", branch: "rework", loopback: true },
    { id: "e7",  from: "g1",  to: "n2a", branch: "fail",   loopback: true },
    { id: "e8",  from: "n3a", to: "n3b", tag: "feature_summary", prompt: "Carry scope.",        sameSession: true },
    { id: "e9",  from: "n3b", to: "n3c", tag: "edge_cases",      prompt: "Pass edge cases.",    sameSession: true },
    { id: "e10", from: "n3c", to: "n4a", tag: "spec_brief",      prompt: "Hand brief." },
    { id: "e11", from: "n4a", to: "n4b", tag: "plan",            prompt: "Pass plan.",          sameSession: true },
    { id: "e12", from: "n4b", to: "n4c", tag: "diff",            prompt: "Forward diff." },
    { id: "e13", from: "n4c", to: "g2",  tag: "review_outcome",  prompt: "Send outcome.",       sameSession: true },
    { id: "e14", from: "g2",  to: "end1", branch: "pass" },
    { id: "e15", from: "g2",  to: "n4b",  branch: "rework", loopback: true },
    { id: "e16", from: "g2",  to: "n4a",  branch: "replan", loopback: true },
  ],
};

describe("canvasToWorkflow", () => {
  it("creates provider agents from canvas sessions plus mock fallback", () => {
    const wf = canvasToWorkflow(wf1Canvas);
    expect(wf.agents.map((a) => a.id).sort()).toEqual([
      "agent-claude-code",
      "agent-codex",
      MOCK_AGENT_ID,
    ]);
  });

  it("preserves all 5 sessions bound to their selected provider agent", () => {
    const wf = canvasToWorkflow(wf1Canvas);
    expect(wf.sessions).toHaveLength(5);
    expect(wf.sessions.find((s) => s.id === "s1")?.agentId).toBe("agent-claude-code");
    expect(wf.sessions.find((s) => s.id === "s3")?.agentId).toBe("agent-codex");
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

  it("same-session edges become passthrough", () => {
    const wf = canvasToWorkflow(wf1Canvas);
    const e1 = wf.edges.find((e) => e.id === "e1");
    expect(e1?.kind).toBe("passthrough");
  });

  it("cross-session tagged edge becomes tagged-output", () => {
    const wf = canvasToWorkflow(wf1Canvas);
    const e2 = wf.edges.find((e) => e.id === "e2");
    expect(e2?.kind).toBe("tagged-output");
    if (e2?.kind === "tagged-output") {
      expect(e2.outputTag.identifier).toBe("component_tree");
      expect(e2.handoff?.agentId).toBe("agent-claude-code");
      expect(e2.handoff?.sessionId).toBe("s2");
    }
  });

  it("agent nodes use the provider selected on their session", () => {
    const wf = canvasToWorkflow(wf1Canvas);
    const review = wf.nodes.find((n) => n.id === "n2c");
    expect(review?.kind).toBe("agent");
    if (review?.kind === "agent") {
      expect(review.agentId).toBe("agent-codex");
      expect(review.sessionId).toBe("s3");
    }
  });

  it("gate-branch pass edge becomes passthrough with sourcePortId=pass", () => {
    const wf = canvasToWorkflow(wf1Canvas);
    const e5 = wf.edges.find((e) => e.id === "e5");
    expect(e5?.kind).toBe("passthrough");
    expect(e5?.sourcePortId).toBe("pass");
  });
});

import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import { parse } from "yaml";
import { initWorkspace } from "./workspace";
import {
  generateCanvasLayout,
  loadCanvas,
  saveCanvas,
} from "./canvas-store";
import { parseAgentFlowSource, stringifyAgentFlowSource } from "./agentflow-source";
import type { CanvasDoc } from "./canvas-doc";

describe("agentflow/canvas storage", () => {
  it("resolves authored keys into internal workflow references", () => {
    const doc = parseAgentFlowSource(`version: 1
name: Review
sessions:
  codex:
    agentServerId: codex-acp
nodes:
  build:
    kind: step
    title: Build
    prompt: Implement
    session: codex
  done:
    kind: end
    title: Done
edges:
  - from: build
    to: done
`, "review-flow");

    expect(doc.id).toBe("review-flow");
    expect(doc.sessions[0]?.id).toBe("codex");
    expect(doc.nodes[0]?.id).toBe("build");
    expect(doc.edges[0]?.id).toBe("edge:build:->done");
  });

  it("round-trips an interactive pause checkpoint on step nodes", () => {
    const doc = parseAgentFlowSource(`version: 1
name: Pause
sessions:
  codex:
    agentServerId: codex-acp
nodes:
  review:
    kind: step
    title: Review
    prompt: Review the change
    session: codex
    pauseAfterRun: true
edges: []
`, "pause-flow");

    expect(doc.nodes[0]).toMatchObject({ kind: "step", pauseAfterRun: true });
    expect(stringifyAgentFlowSource(doc)).toContain("pauseAfterRun: true");
  });

  it("rejects invalid authored keys and missing references", () => {
    expect(() => parseAgentFlowSource(`version: 1
name: Invalid
sessions:
  bad session:
    agentServerId: codex-acp
nodes: {}
edges: []
`, "invalid-flow")).toThrow('session key "bad session"');

    expect(() => parseAgentFlowSource(`version: 1
name: Invalid
sessions:
  codex:
    agentServerId: codex-acp
nodes:
  build:
    kind: step
    title: Build
    session: missing
edges: []
`, "invalid-flow")).toThrow('missing session "missing"');
  });

  it("rejects transfer configuration and multiple business inputs on gate input edges", () => {
    const base = `version: 1
name: Invalid gate
sessions:
  codex:
    agentServerId: codex-acp
nodes:
  first:
    kind: step
    title: First
    prompt: First
    session: codex
  second:
    kind: step
    title: Second
    prompt: Second
    session: codex
  done:
    kind: end
    title: Done
  decide:
    kind: gate
    title: Decide
    decisionCriteria: Pick a branch
    branches:
      pass:
        label: pass
edges:
`;
    expect(() => parseAgentFlowSource(`${base}  - from: first
    to: decide
    transmit: true
    outputTag: result
`, "gate-transfer")).toThrow("cannot declare transmission properties");
    expect(() => parseAgentFlowSource(`${base}  - from: first
    to: decide
  - from: second
    to: decide
`, "gate-input-count")).toThrow("accepts exactly one business input edge");
    expect(() => parseAgentFlowSource(`${base}  - from: first
    to: second
    transmit: true
    outputTag: 123-invalid
`, "invalid-output-tag")).toThrow("XML-safe tag name");
    expect(() => parseAgentFlowSource(`${base}  - from: first
    to: second
    transmit: true
    outputTag: result
`, "same-session-transfer")).toThrow("Same-session edge");
    expect(() => parseAgentFlowSource(`${base}  - from: first
    to: second
    outputTag: result
`, "disabled-transfer-fields")).toThrow("unless transmit is enabled");
    expect(() => parseAgentFlowSource(`${base}  - from: first
    to: done
    transmit: true
    outputTag: result
`, "completion-transfer")).toThrow("Control-only edge");
    expect(() => parseAgentFlowSource(`${base}  - from: decide
    to: done
`, "gate-without-branch")).toThrow("must select a branch");
    expect(() => parseAgentFlowSource(`${base}  - from: done
    to: first
`, "end-source")).toThrow("cannot leave an end node");
    expect(() => parseAgentFlowSource(`${base}  - from: first
    to: decide
    loopback: true
`, "gate-loopback-input")).toThrow("cannot be a loopback edge");
    expect(() => parseAgentFlowSource(`${base}  - from: first
    to: second
  - from: second
    to: first
`, "unmarked-cycle")).toThrow("unmarked cycle");
  });

  it("rejects ambiguous output tags and empty in-memory gates", () => {
    expect(() => parseAgentFlowSource(`version: 1
name: Duplicate tag
sessions:
  source:
    agentServerId: codex-acp
  target:
    agentServerId: claude-acp
nodes:
  first:
    kind: step
    title: First
    prompt: First
    session: source
  second:
    kind: step
    title: Second
    prompt: Second
    session: source
  result:
    kind: step
    title: Result
    prompt: Result
    session: target
edges:
  - from: first
    to: result
    transmit: true
    outputTag: value
  - from: second
    to: result
    transmit: true
    outputTag: value
`, "duplicate-output-tag")).toThrow("duplicate transmitted outputTag");

    const valid = parseAgentFlowSource(`version: 1
name: Empty gate
sessions:
  source:
    agentServerId: codex-acp
nodes:
  gate:
    kind: gate
    title: Gate
    decisionCriteria: Choose
    branches:
      pass: {}
edges: []
`, "empty-gate");
    const gate = valid.nodes.find((node) => node.kind === "gate");
    if (!gate || gate.kind !== "gate") throw new Error("Expected gate");
    gate.branches = [];
    expect(() => stringifyAgentFlowSource(valid)).toThrow("must define at least one branch");

    expect(() => parseAgentFlowSource(`version: 1
name: Alternative tag
sessions:
  source:
    agentServerId: codex-acp
  target:
    agentServerId: claude-acp
nodes:
  source:
    kind: step
    title: Source
    prompt: Source
    session: source
  gate:
    kind: gate
    title: Gate
    decisionCriteria: Choose
    branches:
      pass: {}
      fix: {}
  result:
    kind: step
    title: Result
    prompt: Result
    session: target
edges:
  - from: source
    to: gate
  - from: gate
    to: result
    branch: pass
    transmit: true
    outputTag: value
  - from: gate
    to: result
    branch: fix
    transmit: true
    outputTag: value
`, "alternative-output-tag")).not.toThrow();
  });

  it("initializes agentflows, gitignored canvas layouts, and seed data", async () => {
    const root = await tempProject();
    await initWorkspace(root);

    const gitignore = await readFile(join(root, ".specflow", ".gitignore"), "utf8");
    expect(gitignore).toContain("runs/");
    expect(gitignore).toContain("canvas/");

    const agentflowRaw = await readFile(join(root, ".specflow", "agentflows", "example-code-frontend-flow.yaml"), "utf8");
    const agentflow = parseAgentFlowSource(agentflowRaw, "example-code-frontend-flow");
    expect(agentflow.nodes.some((node) => node.kind === "end")).toBe(true);
    expect("x" in agentflow.nodes[0]!).toBe(false);
    expect(agentflowRaw).toContain("version: 1");
    expect(agentflowRaw).toContain("sessions:\n  parser:");
    expect(agentflowRaw).not.toMatch(/^id:/m);
    expect(agentflowRaw).not.toContain("sessionId:");
    expect(agentflowRaw).not.toContain("color:");

    const canvas = JSON.parse(await readFile(join(root, ".specflow", "canvas", "example-code-frontend-flow.json"), "utf8"));
    expect(canvas.workflowId).toBe("example-code-frontend-flow");
    expect(canvas.nodes[0]).toHaveProperty("nodeId");

    const docsFlowRaw = await readFile(join(root, ".specflow", "agentflows", "example-create-specflow-doc-flow.yaml"), "utf8");
    const docsFlow = parseAgentFlowSource(docsFlowRaw, "example-create-specflow-doc-flow");
    expect(docsFlow.nodes.find((node) => node.id === "discover-docs")?.kind).toBe("step");
    expect(docsFlow.nodes.find((node) => node.id === "documentation-basis")?.kind).toBe("gate");
    expect(docsFlowRaw).toContain(".specflow/product/product.md");
    expect(docsFlowRaw).toContain("classification: undetermined");

    const docsCanvas = JSON.parse(await readFile(join(root, ".specflow", "canvas", "example-create-specflow-doc-flow.json"), "utf8"));
    expect(docsCanvas.workflowId).toBe("example-create-specflow-doc-flow");
  });

  it("creates a first-run workspace and seeds the selected agent server", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-first-run-"));
    await initWorkspace(root, { createIfMissing: true, seedAgentServerId: "chosen-code-acp" });

    for (const workflowId of ["example-code-frontend-flow", "example-create-specflow-doc-flow"]) {
      const agentflow = parseAgentFlowSource(
        await readFile(join(root, ".specflow", "agentflows", `${workflowId}.yaml`), "utf8"),
        workflowId,
      );
      expect(agentflow.sessions.map((session) => session.agentServerId)).toEqual([
        "chosen-code-acp",
        "chosen-code-acp",
        "chosen-code-acp",
        "chosen-code-acp",
        "chosen-code-acp",
      ]);
    }
  });

  it("splits legacy canvas yaml into agentflow yaml and canvas json", async () => {
    const root = await tempProject();
    const specflow = join(root, ".specflow");
    const canvasDir = join(specflow, "canvas");
    await mkdir(canvasDir, { recursive: true });
    await writeFile(join(canvasDir, "legacy.yaml"), legacyCanvasYaml(), "utf8");

    await initWorkspace(root);

    const agentflowRaw = await readFile(join(specflow, "agentflows", "legacy.yaml"), "utf8");
    const agentflow = parseAgentFlowSource(agentflowRaw, "legacy");
    expect(agentflow.id).toBe("legacy");
    expect("x" in agentflow.nodes[0]!).toBe(false);

    const layout = JSON.parse(await readFile(join(canvasDir, "legacy.json"), "utf8"));
    expect(layout.workflowId).toBe("legacy");
    expect(layout.nodes.find((node: { nodeId: string }) => node.nodeId === "done")).toBeTruthy();

    const legacyStillExists = await readFile(join(canvasDir, "legacy.yaml"), "utf8");
    expect(legacyStillExists).toContain("Legacy flow");
  });

  it("regenerates missing or mismatched canvas layout from agentflow", async () => {
    const root = await tempProject();
    await initWorkspace(root);

    const doc: CanvasDoc = {
      id: "regen",
      name: "Regenerate",
      sessions: [{ id: "s1", name: "main", agentServerId: "codex-acp" }],
      nodes: [
        { kind: "step", id: "a", num: "01", x: 10, y: 20, w: 220, title: "A", prompt: "A", sessionId: "s1" },
        { kind: "end", id: "done", num: "END", x: 300, y: 20, w: 140, title: "Done", sessionId: null },
      ],
      edges: [{ id: "e1", from: "a", to: "done" }],
    };
    await saveCanvas(doc.id, doc, root);
    await writeFile(
      join(root, ".specflow", "canvas", "regen.json"),
      `${JSON.stringify({ workflowId: "other", version: 1, nodes: [] })}\n`,
      "utf8",
    );

    const loaded = await loadCanvas("regen", root);
    expect(loaded.nodes.map((node) => node.id)).toEqual(["a", "done"]);
    expect(loaded.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
  });

  it("lays out all agentflow nodes, including input and end", () => {
    const agentflow = parse(legacyCanvasYaml()) as CanvasDoc;
    const layout = generateCanvasLayout({
      id: agentflow.id,
      name: agentflow.name,
      sessions: agentflow.sessions,
      nodes: agentflow.nodes.map(({ x: _x, y: _y, w: _w, ...node }) => node),
      edges: agentflow.edges,
    });
    expect(layout.nodes.map((node) => node.nodeId).sort()).toEqual(["done", "in", "step"].sort());
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specflow-store-"));
  await mkdir(join(root, ".specflow"), { recursive: true });
  return root;
}

function legacyCanvasYaml(): string {
  return `id: legacy
name: Legacy flow
sessions:
  - id: s1
    name: main
    agentServerId: codex-acp
nodes:
  - kind: input
    id: in
    num: IN
    x: 0
    y: 0
    w: 200
    title: Input
    variableName: specflow_value
    sessionId: null
  - kind: step
    id: step
    num: "01"
    x: 260
    y: 0
    w: 220
    title: Step
    prompt: Run <specflow_value>
    sessionId: s1
  - kind: end
    id: done
    num: END
    x: 540
    y: 0
    w: 140
    title: Done
    sessionId: null
edges:
  - id: e0
    from: in
    to: step
  - id: e1
    from: step
    to: done
`;
}

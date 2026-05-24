import type { CanvasDoc } from "./canvas-doc";

export const UNCONFIGURED_AGENT_SERVER_ID = "unconfigured";

export const SEED_CANVAS_DOCS: CanvasDoc[] = [
  {
    id: "example-code-frontend-flow",
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
        images: [{ path: ".specflow/assets/example-code-frontend-flow/images/ticket.png", label: "ticket.png", mimeType: "image/png" }], paths: ["/issues/PROD-2841"],
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
  {
    id: "example-create-specflow-doc-flow",
    name: "Create Specflow project docs",
    sessions: [
      { id: "document-researcher", name: "document-researcher", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
      { id: "code-analyst", name: "code-analyst", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
      { id: "project-classifier", name: "project-classifier", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
      { id: "documentation-writer", name: "documentation-writer", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
      { id: "documentation-reviewer", name: "documentation-reviewer", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
    ],
    nodes: [
      { kind: "step", id: "discover-docs", num: "01", x: 60, y: 260, w: 250,
        title: "Discover project documents",
        prompt: `Inventory existing project-level documentation before making changes.

Scan the entire repository for documentation sources, including README/README.* files, ADR or adr-*.md files, architecture/design/RFC/decision records, CONTRIBUTING and governance files, and files under docs/, doc/, documentation/, adr/, decisions/, or equivalent directories. Include relevant package-level READMEs when they explain a subsystem. Also inspect any existing .specflow documentation.

Ignore dependency, build, coverage, generated, cache, and VCS directories unless a file is intentionally authored documentation. Do not edit files in this step. Return a compact source inventory grouped by purpose, with relative paths, useful facts, conflicts, and documentation gaps.`,
        paths: ["README.md", "docs/", ".specflow/"],
        sessionId: "document-researcher", locked: true },

      { kind: "step", id: "survey-code", num: "02", x: 380, y: 260, w: 270,
        title: "Roughly survey implementation",
        prompt: `Use <specflow_document_inventory> as the documentation evidence, then perform a rough, read-only source scan.

Inspect the repository tree, package/build manifests, entry points, primary source directories, runtime boundaries, tests, configuration, and public APIs. Do not attempt exhaustive line-by-line analysis and do not inspect vendor/build/generated/cache content. Identify languages and tools, package or service boundaries, major runtime/data flows, established conventions, product clues, and glossary-worthy terms.

Explicitly assess whether the project contains substantive first-party implementation or meaningful product documentation. A repository that only contains empty placeholders, editor/VCS setup, licenses, generated/vendor artifacts, or trivial manifests should be treated as minimal/undetermined. Return evidence with relative paths and carry forward the important documentation sources from the inventory.`,
        sessionId: "code-analyst", locked: true },

      { kind: "step", id: "classify-project", num: "03", x: 720, y: 260, w: 270,
        title: "Classify documentation basis",
        prompt: `Review <specflow_repository_survey> and decide whether grounded project documentation can be authored.

Return exactly one leading classification line: "classification: substantive" when there is enough first-party code or documentation to describe the project without invention, or "classification: undetermined" when the repository is empty, placeholder-only, or too sparse. Then provide an evidence-backed brief for a writer: verified facts, existing documents to link, unknowns that must remain marked unknown, and recommended optional .specflow files beyond the standard set.`,
        sessionId: "project-classifier", locked: true },

      { kind: "gate", id: "documentation-basis", num: "G1", x: 1050, y: 270, w: 230,
        title: "Documentation basis",
        decisionCriteria: `Route from the classification statement in the incoming assessment. Choose substantive only when it begins with "classification: substantive". Choose undetermined when it begins with "classification: undetermined", or whenever evidence is insufficient to make accurate project claims.`,
        branches: [
          { id: "substantive", label: "substantive" },
          { id: "undetermined", label: "undetermined" },
        ] },

      { kind: "step", id: "write-grounded-docs", num: "04·a", x: 1360, y: 100, w: 300,
        title: "Write grounded Specflow docs",
        prompt: `Use <specflow_project_assessment> and verify cited sources as needed. Create or conservatively update project documentation under .specflow without deleting authored content.

Write the standard files:
- .specflow/product/product.md: purpose, users/use cases, capabilities and current boundaries.
- .specflow/architecture.md: package/service map, runtime/data flow, integrations and source links.
- .specflow/glossary.md: project terms and meanings supported by evidence.
- .specflow/conventions.md: evidenced engineering, file layout, testing and workflow conventions.

Use Markdown links to existing repository documents instead of duplicating long source text. Attribute key claims with relative source paths. Where useful, add narrowly named custom docs such as .specflow/source-index.md, .specflow/product/open-questions.md, or a subsystem note, but only when evidence warrants it. Clearly label inferences and unknowns. Do not invent product behavior or policy. Return the files changed and the source links represented in them.`,
        paths: [".specflow/"],
        sessionId: "documentation-writer" },

      { kind: "step", id: "write-placeholder-docs", num: "04·b", x: 1360, y: 440, w: 300,
        title: "Write undetermined docs",
        prompt: `Use <specflow_project_assessment>. The repository lacks enough substantive evidence for descriptive documentation.

Create or conservatively update these files:
- .specflow/product/product.md
- .specflow/architecture.md
- .specflow/glossary.md
- .specflow/conventions.md

Each file must clearly say that the project is currently undetermined or has insufficient source material, list any minimal evidence found, and state what future evidence would allow the document to be filled in. Do not fabricate purpose, architecture, terminology, or conventions. Add .specflow/source-index.md only if it helps record the scan evidence. Return the files changed and the reason they remain placeholders.`,
        paths: [".specflow/"],
        sessionId: "documentation-writer" },

      { kind: "step", id: "review-grounded-docs", num: "05·a", x: 1720, y: 100, w: 280,
        title: "Verify grounded docs",
        prompt: `Review the generated documentation using <specflow_documentation_changes>. Check that the four standard .specflow files exist, links resolve to real repository files, important claims are traceable to source evidence, inferred statements are labeled, and no unsupported content was added. Fix small documentation defects directly when needed. Summarize coverage, custom files, fixes, and remaining unknowns.`,
        paths: [".specflow/"],
        sessionId: "documentation-reviewer" },

      { kind: "step", id: "review-placeholder-docs", num: "05·b", x: 1720, y: 440, w: 280,
        title: "Verify undetermined docs",
        prompt: `Review the placeholder documentation using <specflow_placeholder_changes>. Confirm that the four standard .specflow files exist, each explicitly records insufficient evidence rather than fabricated facts, and any cited paths actually exist. Fix small documentation defects directly when needed. Summarize what evidence is still required before substantive docs can be produced.`,
        paths: [".specflow/"],
        sessionId: "documentation-reviewer" },

      { kind: "end", id: "docs-ready", num: "END", x: 2070, y: 270, w: 160,
        title: "Docs ready", sessionId: null },
    ],
    edges: [
      { id: "d1", from: "discover-docs", to: "survey-code", transmit: true, outputTag: "document_inventory", handoffPrompt: "Pass the discovered documentation sources and gaps into the implementation survey." },
      { id: "d2", from: "survey-code", to: "classify-project", transmit: true, outputTag: "repository_survey", handoffPrompt: "Pass the evidence-based repository survey for documentation classification." },
      { id: "d3", from: "classify-project", to: "documentation-basis" },
      { id: "d4", from: "documentation-basis", to: "write-grounded-docs", branch: "substantive", transmit: true, outputTag: "project_assessment", handoffPrompt: "Provide the validated assessment for grounded documentation authoring." },
      { id: "d5", from: "documentation-basis", to: "write-placeholder-docs", branch: "undetermined", transmit: true, outputTag: "project_assessment", handoffPrompt: "Provide the minimal-evidence assessment for placeholder documentation." },
      { id: "d6", from: "write-grounded-docs", to: "review-grounded-docs", transmit: true, outputTag: "documentation_changes", handoffPrompt: "Pass the documentation change report for source-grounded review." },
      { id: "d7", from: "write-placeholder-docs", to: "review-placeholder-docs", transmit: true, outputTag: "placeholder_changes", handoffPrompt: "Pass the placeholder change report for non-fabrication review." },
      { id: "d8", from: "review-grounded-docs", to: "docs-ready" },
      { id: "d9", from: "review-placeholder-docs", to: "docs-ready" },
    ],
  },
];

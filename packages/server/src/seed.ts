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
  {
    id: "example-specflow-homepage-flow",
    name: "Create a commercial project homepage",
    sessions: [
      { id: "homepage-researcher", name: "homepage-researcher", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
      { id: "homepage-strategist", name: "homepage-strategist", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
      { id: "homepage-designer", name: "homepage-designer", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
      { id: "homepage-builder", name: "homepage-builder", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
      { id: "homepage-reviewer", name: "homepage-reviewer", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
    ],
    variables: [
      {
        name: "specflow_source_project_path",
        description: "Absolute path to the source code project to analyze. Before running, configure the selected Codex agent server with this same path in Additional directories. The source project is read-only; page files are created in this Specflow workspace.",
      },
      {
        name: "specflow_homepage_direction",
        defaultValue: "Build a premium, credible landing page for a developer-facing software product. Prefer a focused single-page site with a strong product visual, restrained motion, responsive behavior, and only evidence-backed claims.",
        description: "Optional audience, brand, CTA, language, or delivery constraints for the generated homepage.",
      },
    ],
    nodes: [
      { kind: "input", id: "source-project-path", num: "IN", x: 40, y: 80, w: 270,
        title: "Source project directory",
        variableName: "specflow_source_project_path",
        description: "Add this absolute directory to the Codex agent server Additional directories before running. It is a read-only research source; output is written to the current workspace.",
        sessionId: null },
      { kind: "input", id: "homepage-direction", num: "IN", x: 40, y: 610, w: 270,
        title: "Homepage direction",
        variableName: "specflow_homepage_direction",
        defaultValue: "Build a premium, credible landing page for a developer-facing software product. Prefer a focused single-page site with a strong product visual, restrained motion, responsive behavior, and only evidence-backed claims.",
        description: "Override with audience, brand, CTA, language, framework, or delivery requirements.",
        sessionId: null },

      { kind: "step", id: "inspect-source", num: "01", x: 370, y: 300, w: 290,
        title: "Validate and inspect source",
        prompt: `You are researching a software product in order to build its public-facing homepage.

SOURCE PROJECT (read-only): <specflow_source_project_path>
HOMEPAGE DIRECTION: <specflow_homepage_direction>
OUTPUT WORKSPACE: the current working directory where this Specflow run is executing.

First validate access to SOURCE PROJECT. It must exist, be readable, and be distinct from OUTPUT WORKSPACE. The source directory should already have been added to this Codex agent server's Additional directories before the run. Never write, format, install dependencies, or generate files inside SOURCE PROJECT.

If you cannot read the source project safely, begin your response with exactly "readiness: blocked" and explain the required Additional directories configuration or path correction. Do not infer product claims.

If it is accessible, begin with exactly "readiness: ready" and perform an evidence-driven, read-only discovery pass. Inspect README files, .specflow product/architecture/glossary/conventions notes, docs/ and ADRs, package/build manifests, primary entrypoints, visible UI components/styles/assets, screenshots or brand assets, and install/run instructions. Ignore dependencies, generated builds, caches, runs, secrets, and irrelevant internal churn.

Return a source dossier containing:
- product category, target user, problem, workflow, differentiators, and credible CTA options;
- concrete source paths supporting each public claim;
- existing brand tokens/assets or UI motifs worth translating into a hero visual;
- commands or links that are safe to publish;
- missing evidence and claims that must not appear (including invented customers, metrics, pricing, compliance, testimonials, or integrations).`,
        sessionId: "homepage-researcher", locked: true },

      { kind: "gate", id: "source-readiness", num: "G1", x: 730, y: 310, w: 230,
        title: "Source usable?",
        decisionCriteria: `Read the first classification line from the source dossier. Choose ready only if it begins with "readiness: ready" and contains evidence sufficient to market the product without fabrication. Choose blocked if it begins with "readiness: blocked", the source path is inaccessible, the source equals the output workspace, or credible product facts cannot be established.`,
        branches: [
          { id: "ready", label: "ready" },
          { id: "blocked", label: "blocked" },
        ] },

      { kind: "step", id: "report-blocked", num: "STOP", x: 1050, y: 620, w: 290,
        title: "Report setup required",
        prompt: `The source-project preflight did not pass. Do not create a speculative landing page. Summarize exactly how to make the next run actionable: use an absolute source project path, add that directory to the selected Codex agent server Additional directories, keep it separate from the empty output workspace, and rerun this flow. Do not edit project files.`,
        sessionId: "homepage-researcher", locked: true },

      { kind: "step", id: "position-product", num: "02", x: 1050, y: 120, w: 300,
        title: "Define positioning and copy",
        prompt: `Use <specflow_source_dossier> as the only factual basis and apply these constraints:
<specflow_homepage_direction>

Act as a senior developer-product marketing strategist. Convert technical evidence into a concise homepage messaging brief for a mature commercial software landing page. Define the audience, one-sentence positioning, primary outcome, hero headline and subhead options, primary/secondary CTA copy and truthful destinations, three to five capability narratives, a workflow story, and a final CTA.

Commercial-quality pages for developer tools generally use an outcome-led hero, an authentic product visualization, scannable capability chapters, proof or trust only where verifiable, clear docs/install pathways, and a strong closing CTA. Apply that information architecture without copying another brand.

Truthfulness is mandatory. Every claim must cite the supporting source path from the dossier. Omit testimonials, logo walls, usage metrics, security badges, enterprise claims, pricing and integration lists unless directly evidenced. Mark any attractive but unsupported concept as prohibited copy. Return a copy deck plus an evidence/prohibition table.`,
        sessionId: "homepage-strategist" },

      { kind: "step", id: "design-blueprint", num: "03", x: 1410, y: 120, w: 310,
        title: "Design page blueprint",
        prompt: `Use <specflow_positioning_brief> to produce a detailed landing-page blueprint that an implementation agent can execute precisely.

Specify:
- page section order, purpose, final draft copy, CTA locations, and evidence constraints;
- a premium developer-tool visual direction: typography hierarchy, spacing rhythm, color tokens, surfaces, border/radius system, background treatment, icon approach, and restrained interaction/motion;
- a hero product visual derived from real product behavior (for example a workflow canvas, code/terminal sequence, execution timeline, or UI panel) using only HTML/CSS/SVG and text supported by source evidence;
- desktop, tablet and mobile layout behavior; navigation, footer, accessibility semantics, focus/hover states, reduced-motion behavior, performance limits and SEO metadata;
- an implementation component outline and reusable design tokens.

The result should feel comparable in polish and information structure to a modern commercial developer-product homepage, while remaining original and factual. Do not request external images, invented screenshots, fabricated social proof, or copyrighted competitor assets. Return an implementation-ready creative brief with exact sections and copy.`,
        sessionId: "homepage-designer" },

      { kind: "step", id: "audit-blueprint", num: "04", x: 1780, y: 120, w: 300,
        title: "Audit claims and UX brief",
        prompt: `Review <specflow_page_blueprint> as a strict product, content and UX auditor before any code is written.

Check that every product statement and CTA is grounded in the source dossier, the structure is persuasive rather than documentation-like, the hero visual communicates real product value, the page has a coherent responsive design system, accessibility and reduced-motion requirements are actionable, and forbidden unsourced proof is absent.

Correct any weak, generic, unsupported, or overly technical copy directly in your output. Produce one final approved build specification: exact section order and text, design-token requirements, UI mock content, permitted source references/assets, banned claims, file-level implementation acceptance criteria, and a verification checklist. This approved specification replaces earlier drafts.`,
        sessionId: "homepage-reviewer" },

      { kind: "step", id: "plan-site", num: "05", x: 2140, y: 120, w: 310,
        title: "Plan target implementation",
        prompt: `Use <specflow_approved_homepage_spec>. You are the implementation owner working only in OUTPUT WORKSPACE, never in SOURCE PROJECT (<specflow_source_project_path>).

Inspect the output workspace and determine its delivery shape. If it already contains an intentional frontend scaffold, preserve its toolchain, conventions and build path. If it is empty apart from .specflow files, produce a dependency-free responsive static site using index.html, styles.css, optional main.js and an output README with preview instructions; do not require package installation merely to view the landing page.

Before editing, return a short implementation plan naming the files to create or change, component/section structure, asset strategy, commands available for verification, and how the approved copy and design tokens map into the files. No edits in this planning step.`,
        sessionId: "homepage-builder" },

      { kind: "step", id: "build-site", num: "06", x: 2500, y: 120, w: 310,
        title: "Build landing page",
        prompt: `Implement the approved homepage according to the plan already established in this session.

Requirements:
- write only inside OUTPUT WORKSPACE and never modify <specflow_source_project_path>;
- implement every approved section and CTA with factual copy;
- create an expressive, high-fidelity hero visualization using original HTML/CSS/SVG or product assets explicitly permitted in the specification;
- use well-factored semantic markup/components and centralized design tokens;
- implement responsive desktop/tablet/mobile layouts, accessible navigation and controls, keyboard focus visibility, usable contrast, reduced-motion support, metadata and a polished footer;
- avoid generic AI-generated decoration, placeholder copy, fake links, fabricated logos/testimonials/metrics, and unnecessary dependencies.

Run whatever local formatting/build or static validation is already supported. Return changed files, preview/run instructions, validation results, and any constraint that prevented complete implementation.`,
        sessionId: "homepage-builder" },

      { kind: "step", id: "polish-experience", num: "07", x: 2860, y: 120, w: 310,
        title: "Polish visual experience",
        prompt: `Use <specflow_implementation_report>, then open the generated site files in OUTPUT WORKSPACE and conduct a visual-design implementation pass.

Improve the actual files where needed: hierarchy, whitespace, typography scale, color and contrast, hero composition, card rhythm, navigation and CTA prominence, breakpoint behavior, small-screen readability, hover/focus/reduced-motion states, and developer-tool authenticity. Verify that the page presents a coherent narrative from hero through final CTA and does not look like a template.

Preserve factual copy and do not alter the source project. Do not add unverified trust claims or external copyrighted media. Return a concise polish report listing edits, remaining concerns and recommended verification commands.`,
        sessionId: "homepage-designer" },

      { kind: "step", id: "verify-release", num: "08", x: 3220, y: 120, w: 310,
        title: "Verify release quality",
        prompt: `Use <specflow_polish_report>. Perform a rigorous release review of the generated landing page in OUTPUT WORKSPACE.

Inspect the implemented source and run the relevant available validation or build commands. Assess: content traceability to source evidence; absence of fabricated claims and broken CTAs; section completeness against the approved spec; semantic HTML and keyboard/focus behavior; contrast and reduced-motion handling; responsive behavior at narrow and wide layouts; asset/load hygiene; metadata; and whether the hero and overall page meet a commercial developer-product quality bar.

Fix only small, obvious defects directly if that completes the review. Begin the response with exactly "verdict: pass" only if the page is ready to present, or "verdict: fix" followed by a prioritized, file-specific correction list if substantial work remains.`,
        sessionId: "homepage-reviewer" },

      { kind: "gate", id: "release-decision", num: "G2", x: 3590, y: 130, w: 230,
        title: "Release verdict",
        decisionCriteria: `Choose pass only when the incoming review begins with "verdict: pass". Choose fix whenever it begins with "verdict: fix", any acceptance item is unresolved, validation failed, or commercial presentation quality is not yet met.`,
        branches: [
          { id: "pass", label: "pass" },
          { id: "fix", label: "fix" },
        ] },

      { kind: "step", id: "repair-site", num: "09", x: 3930, y: 360, w: 310,
        title: "Repair release issues",
        prompt: `Use <specflow_release_findings>. Repair all substantive release issues in OUTPUT WORKSPACE while preserving the approved truthful messaging and original design direction. Make concrete file edits, rerun applicable validation, and return a final repair report with changed files, tests/build output, and any unresolved limitation. Never modify SOURCE PROJECT (<specflow_source_project_path>).`,
        sessionId: "homepage-builder" },

      { kind: "step", id: "verify-repair", num: "10", x: 4300, y: 360, w: 300,
        title: "Final repaired review",
        prompt: `Use <specflow_repair_report> and inspect the repaired landing page. Run available verification again and resolve any minor final defects you can safely fix in OUTPUT WORKSPACE. Confirm whether content remains evidence-backed, presentation is polished and responsive, accessibility fundamentals are satisfied, and preview instructions work. Return a final delivery summary; explicitly list unresolved issues rather than masking them.`,
        sessionId: "homepage-reviewer" },

      { kind: "end", id: "homepage-ready", num: "END", x: 3930, y: 80, w: 190,
        title: "Homepage ready", sessionId: null },
      { kind: "end", id: "homepage-blocked", num: "END", x: 1410, y: 620, w: 190,
        title: "Setup required", sessionId: null },
      { kind: "end", id: "homepage-repaired", num: "END", x: 4670, y: 360, w: 190,
        title: "Repair reviewed", sessionId: null },
    ],
    edges: [
      { id: "h1", from: "inspect-source", to: "source-readiness" },
      { id: "h2", from: "source-readiness", to: "position-product", branch: "ready", transmit: true, outputTag: "source_dossier", handoffPrompt: "Forward the validated source dossier for evidence-grounded homepage positioning." },
      { id: "h3", from: "source-readiness", to: "report-blocked", branch: "blocked" },
      { id: "h4", from: "report-blocked", to: "homepage-blocked" },
      { id: "h5", from: "position-product", to: "design-blueprint", transmit: true, outputTag: "positioning_brief", handoffPrompt: "Forward the evidence-backed messaging and claims constraints into page design." },
      { id: "h6", from: "design-blueprint", to: "audit-blueprint", transmit: true, outputTag: "page_blueprint", handoffPrompt: "Forward the full creative blueprint for strict content and UX approval." },
      { id: "h7", from: "audit-blueprint", to: "plan-site", transmit: true, outputTag: "approved_homepage_spec", handoffPrompt: "Forward the corrected, approved implementation specification." },
      { id: "h8", from: "plan-site", to: "build-site" },
      { id: "h9", from: "build-site", to: "polish-experience", transmit: true, outputTag: "implementation_report", handoffPrompt: "Forward the built-page report for visual refinement in the output workspace." },
      { id: "h10", from: "polish-experience", to: "verify-release", transmit: true, outputTag: "polish_report", handoffPrompt: "Forward the polished implementation report for release verification." },
      { id: "h11", from: "verify-release", to: "release-decision" },
      { id: "h12", from: "release-decision", to: "homepage-ready", branch: "pass" },
      { id: "h13", from: "release-decision", to: "repair-site", branch: "fix", transmit: true, outputTag: "release_findings", handoffPrompt: "Forward the file-specific release defects for implementation repair." },
      { id: "h14", from: "repair-site", to: "verify-repair", transmit: true, outputTag: "repair_report", handoffPrompt: "Forward repaired files and validation results for the final review." },
      { id: "h15", from: "verify-repair", to: "homepage-repaired" },
    ],
  },
];

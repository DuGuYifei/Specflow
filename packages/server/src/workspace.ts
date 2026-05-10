import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

/*
 * .specflow/ directory layout managed by this module:
 *
 *   canvas/
 *     <workflow-id>.yaml     — node positions, edges, sessions for one workflow
 *
 *   runs/
 *     <run-id>.yaml          — run metadata + canvas snapshot at time of run
 *
 *   .gitignore               — ignores runs/ (run records are local-only)
 *
 * ── canvas/<id>.yaml schema ──────────────────────────────────────────────────
 *
 *   id: wf1
 *   title: Frontend ticket flow
 *   sessions:
 *     - id: s1
 *       name: parser
 *       color: oklch(0.78 0.13 45)
 *       agent: claude-code
 *   nodes:
 *     - id: n1
 *       kind: step          # step | gate | end
 *       num: "01"
 *       x: 60
 *       y: 240
 *       w: 230
 *       title: Ticket
 *       desc: Capture the incoming ticket.
 *       sessionId: s1
 *       updateDoc: false
 *       locked: true
 *       attachments:
 *         - label: ticket.png
 *       paths:
 *         - /issues/PROD-2841
 *     - id: g1
 *       kind: gate
 *       num: G1
 *       x: 1140
 *       y: 200
 *       w: 160
 *       title: Quality gate
 *       branches:
 *         - id: pass
 *           label: pass
 *           color: oklch(0.74 0.13 145)
 *         - id: retry
 *           label: retry
 *           color: oklch(0.74 0.13 45)
 *   edges:
 *     - id: e1
 *       from: n1
 *       to: n2a
 *       tag: ticket_summary
 *       prompt: "Output a structured summary."
 *     - id: e2
 *       from: n2a
 *       to: n2b
 *       sameSession: true
 *
 * ── runs/<id>.yaml schema ─────────────────────────────────────────────────────
 *
 *   id: r12
 *   workflowId: wf1
 *   label: "Run #248"
 *   ticket: "PROD-2841"
 *   status: running        # running | success | error | idle | pending
 *   activeNode: n4b
 *   startedAt: 2024-01-15T14:02:11Z
 *   duration: "2m 18s"
 *   agent: claude-code
 *   errorMsg: ~
 *   node_states:
 *     n1:  success
 *     n2a: success
 *     n2b: success
 *     n4b: running
 *   canvas_snapshot:        # copy of canvas/<workflowId>.yaml at run start
 *     sessions: [...]
 *     nodes: [...]
 *     edges: [...]
 */

const GITIGNORE_CONTENT = "runs/\n";

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function initWorkspace(cwd: string = process.cwd()): Promise<void> {
  const root = join(cwd, ".specflow");

  // Silently skip if the project has no .specflow directory yet.
  if (!await pathExists(root)) return;

  await Promise.all([
    mkdir(join(root, "canvas"), { recursive: true }),
    mkdir(join(root, "runs"),   { recursive: true }),
  ]);

  const gitignorePath = join(root, ".gitignore");
  if (!await pathExists(gitignorePath)) {
    await writeFile(gitignorePath, GITIGNORE_CONTENT, "utf8");
  }
}

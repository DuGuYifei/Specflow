import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCli } from "./index.js";

const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await Promise.all(
    tempRoots.map((root) => rm(root, { recursive: true, force: true }))
  );
  tempRoots.length = 0;
});

describe("workflow commands", () => {
  it("includes the local UI command", () => {
    expect(createCli().helpInformation()).toContain("ui");
  });

  it("runs, lists, and shows a workflow from inline ticket input", async () => {
    const root = await createRepositoryRoot();
    const { logs, runCommand } = captureCli(root);

    await runCommand("workflow", "run", "--ticket", "Implement CLI run.");
    const runId = findRunId(logs);

    expect(logs).toContain("Specflow workflow run");
    expect(logs).toContain("status: completed");
    expect(runId).toMatch(/^run_/);

    logs.length = 0;
    await runCommand("workflow", "list");

    expect(logs).toContain("Specflow workflow runs");
    expect(logs.some((line) => line.includes(runId))).toBe(true);

    logs.length = 0;
    await runCommand("workflow", "show", runId);

    expect(logs).toContain("Specflow workflow run");
    expect(logs).toContain(`run: ${runId}`);
    expect(logs.some((line) => line.includes("final-patch"))).toBe(true);
  });

  it("runs a workflow from ticket file input", async () => {
    const root = await createRepositoryRoot();
    const ticketFile = join(root, "ticket.md");
    const { logs, runCommand } = captureCli(root);

    await writeFile(ticketFile, "Implement file ticket input.", "utf8");
    await runCommand("workflow", "run", "--ticket-file", ticketFile);

    expect(logs).toContain("ticket source: file");
    expect(findRunId(logs)).toMatch(/^run_/);
  });

  it("rejects ambiguous ticket input", async () => {
    const root = await createRepositoryRoot();
    const { errors, runCommand } = captureCli(root);

    await runCommand(
      "workflow",
      "run",
      "--ticket",
      "inline",
      "--ticket-file",
      "ticket.md"
    );

    expect(process.exitCode).toBe(1);
    expect(errors).toContain("error: use either --ticket or --ticket-file, not both.");
  });

  it("validates repository workflow definitions", async () => {
    const root = await createRepositoryRoot();
    const { logs, runCommand } = captureCli(root);

    await mkdir(join(root, ".specflow", "workflows"), { recursive: true });
    await writeFile(
      join(root, ".specflow", "workflows", "demo.workflow.json"),
      JSON.stringify(
        {
          id: "demo",
          name: "Demo Workflow",
          nodes: [
            {
              id: "ticket-input",
              type: "ticket",
              label: "Ticket Input",
              status: "pending"
            }
          ],
          edges: []
        },
        null,
        2
      ),
      "utf8"
    );

    await runCommand("workflow", "validate");

    expect(logs).toContain(
      "repository definition: workflows/demo.workflow.json Demo Workflow"
    );
    expect(logs).toContain("valid: true");
    expect(logs).toContain("runtime compatible: false");
    expect(logs).toContain(
      "runtime issue: workflows/demo.workflow.json: Missing node required by local placeholder runtime: spec-context"
    );
    expect(process.exitCode).toBe(1);
  });
});

function captureCli(root: string): {
  logs: string[];
  errors: string[];
  runCommand: (...args: string[]) => Promise<void>;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalCwd = process.cwd();

  vi.spyOn(console, "log").mockImplementation((message = "") => {
    logs.push(String(message));
  });
  vi.spyOn(console, "error").mockImplementation((message = "") => {
    errors.push(String(message));
  });

  return {
    logs,
    errors,
    async runCommand(...args: string[]) {
      process.chdir(root);
      try {
        await createCli().parseAsync(["node", "specflow", ...args]);
      } finally {
        process.chdir(originalCwd);
      }
    }
  };
}

function findRunId(logs: string[]): string {
  const runLine = logs.find((line) => line.startsWith("run: "));

  if (!runLine) {
    throw new Error("Run id not found in CLI output.");
  }

  return runLine.slice("run: ".length);
}

async function createRepositoryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specflow-cli-"));
  tempRoots.push(root);

  await mkdir(join(root, ".specflow"), { recursive: true });
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
  await writeFile(join(root, ".specflow", "project.md"), "# CLI Test\n", "utf8");

  return root;
}

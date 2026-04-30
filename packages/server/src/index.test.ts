import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPhase1LocalLoopGraph } from "@specflow/runtime";
import { buildServer } from "./index.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.map((root) => rm(root, { recursive: true, force: true }))
  );
  tempRoots.length = 0;
});

describe("server routes", () => {
  it("responds to health checks", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "specflow-server"
    });
  });

  it("serves local run APIs", async () => {
    const root = await createRepositoryRoot();
    const server = buildServer({
      root,
      uiDistPath: await createUiDist(),
      stepDelayMs: 1
    });
    const emptyList = await server.inject({ method: "GET", url: "/api/runs" });

    expect(emptyList.statusCode).toBe(200);
    expect(emptyList.json()).toEqual({ runs: [] });

    const badCreate = await server.inject({
      method: "POST",
      url: "/api/runs",
      payload: {}
    });

    expect(badCreate.statusCode).toBe(400);

    const created = await server.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        ticket: "Observe the local workflow."
      }
    });
    const createdBody = created.json() as { runId: string };

    expect(created.statusCode).toBe(202);
    expect(createdBody.runId).toMatch(/^run_/);

    const run = await waitForRun(server, createdBody.runId);
    const artifact = run.artifacts[0];
    const artifactResponse = await server.inject({
      method: "GET",
      url: `/api/runs/${run.id}/artifacts/${artifact.id}`
    });

    expect(run.status).toBe("completed");
    expect(run.workflowDefinition).toMatchObject({
      id: "phase-1-local-loop",
      source: "builtin"
    });
    expect(artifactResponse.statusCode).toBe(200);
    expect(artifactResponse.json().artifact.id).toBe(artifact.id);
  });

  it("creates runs against a selected repository workflow definition", async () => {
    const root = await createRepositoryRoot();
    const server = buildServer({
      root,
      uiDistPath: await createUiDist(),
      stepDelayMs: 1
    });
    const definition = createPhase1LocalLoopGraph();
    definition.id = "repository-local-loop";
    definition.name = "Repository Local Loop";
    definition.version = "0.2.0";

    await writeWorkflowDefinition(root, "selected.workflow.json", definition);

    const created = await server.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        ticket: "Use the selected repository definition.",
        workflowDefinitionId: "repository-local-loop"
      }
    });
    const createdBody = created.json() as { runId: string; run: unknown };

    expect(created.statusCode).toBe(202);
    expect(createdBody.runId).toMatch(/^run_/);

    const run = await waitForRun(server, createdBody.runId);

    expect(run.status).toBe("completed");
    expect(run.workflowDefinition).toEqual({
      id: "repository-local-loop",
      name: "Repository Local Loop",
      source: "repository",
      version: "0.2.0",
      path: "workflows/selected.workflow.json"
    });
  });

  it("rejects unknown workflow definition ids", async () => {
    const root = await createRepositoryRoot();
    const server = buildServer({
      root,
      uiDistPath: await createUiDist()
    });
    const response = await server.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        ticket: "Use a missing definition.",
        workflowDefinitionId: "missing"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Workflow definition not found: missing"
    });
  });

  it("serves repository workflow definitions with validation", async () => {
    const root = await createRepositoryRoot();
    const server = buildServer({
      root,
      uiDistPath: await createUiDist()
    });

    await mkdir(join(root, ".specflow", "workflows"), { recursive: true });
    await writeFile(
      join(root, ".specflow", "workflows", "demo.workflow.json"),
      JSON.stringify(
        {
          id: "demo",
          name: "Demo Workflow",
          entryNodeId: "ticket-input",
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

    const response = await server.inject({ method: "GET", url: "/api/workflows" });
    const body = response.json() as {
      workflows: Array<{
        source: string;
        path: string;
        definition: { id: string };
        validation: { valid: boolean };
        runtimeCompatibility: {
          valid: boolean;
          issues: Array<{ message: string }>;
        };
        executionPreview: {
          workflowId: string;
          nodes: Array<{ nodeId: string; executionMode: string }>;
        };
      }>;
    };

    expect(response.statusCode).toBe(200);
    expect(body.workflows).toHaveLength(1);
    expect(body.workflows[0]).toMatchObject({
      source: "repository",
      path: "workflows/demo.workflow.json",
      definition: { id: "demo" },
      validation: { valid: true },
      runtimeCompatibility: {
        valid: false
      },
      executionPreview: {
        workflowId: "demo",
        nodes: [{ nodeId: "ticket-input", executionMode: "system" }]
      }
    });
    expect(body.workflows[0]?.runtimeCompatibility.issues[0]?.message).toBe(
      "Missing node required by local placeholder runtime: spec-context"
    );
  });

  it("serves builtin workflow definitions with runtime compatibility", async () => {
    const root = await createRepositoryRoot();
    const server = buildServer({
      root,
      uiDistPath: await createUiDist()
    });
    const response = await server.inject({ method: "GET", url: "/api/workflows" });
    const body = response.json() as {
      workflows: Array<{
        source: string;
        definition: { id: string };
        validation: { valid: boolean };
        runtimeCompatibility: { valid: boolean; issues: unknown[] };
        executionPreview: {
          workflowId: string;
          nodes: Array<{
            nodeId: string;
            executionMode: string;
            agentCli?: { cli: string };
            session: { groupId?: string };
          }>;
        };
      }>;
    };

    expect(response.statusCode).toBe(200);
    expect(body.workflows).toHaveLength(1);
    expect(body.workflows[0]).toMatchObject({
      source: "builtin",
      definition: { id: "phase-1-local-loop" },
      validation: { valid: true },
      runtimeCompatibility: { valid: true, issues: [] },
      executionPreview: {
        workflowId: "phase-1-local-loop"
      }
    });
    expect(
      body.workflows[0]?.executionPreview.nodes.find((node) => node.nodeId === "plan")
    ).toMatchObject({
      executionMode: "agent",
      agentCli: { cli: "codex" },
      session: { groupId: "implementation" }
    });
  });

  it("serves the UI shell", async () => {
    const root = await createRepositoryRoot();
    const server = buildServer({
      root,
      uiDistPath: await createUiDist()
    });
    const response = await server.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Specflow");
  });
});

async function waitForRun(
  server: ReturnType<typeof buildServer>,
  runId: string
): Promise<{
  id: string;
  status: string;
  artifacts: Array<{ id: string }>;
  workflowDefinition: {
    id: string;
    name: string;
    source: string;
    version?: string;
    path?: string;
  };
}> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await server.inject({
      method: "GET",
      url: `/api/runs/${runId}`
    });

    if (response.statusCode !== 200) {
      await wait(10);
      continue;
    }

    const body = response.json() as {
      run: {
        id: string;
        status: string;
        artifacts: Array<{ id: string }>;
        workflowDefinition: {
          id: string;
          name: string;
          source: string;
          version?: string;
          path?: string;
        };
      };
    };

    if (body.run.status === "completed" || body.run.status === "failed") {
      return body.run;
    }

    await wait(10);
  }

  throw new Error("Timed out waiting for workflow run.");
}

async function writeWorkflowDefinition(
  root: string,
  fileName: string,
  definition: ReturnType<typeof createPhase1LocalLoopGraph>
): Promise<void> {
  await mkdir(join(root, ".specflow", "workflows"), { recursive: true });
  await writeFile(
    join(root, ".specflow", "workflows", fileName),
    JSON.stringify(definition, null, 2),
    "utf8"
  );
}

async function createRepositoryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specflow-server-"));
  tempRoots.push(root);

  await mkdir(join(root, ".specflow"), { recursive: true });
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
  await writeFile(join(root, ".specflow", "project.md"), "# Server Test\n", "utf8");

  return root;
}

async function createUiDist(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specflow-ui-dist-"));
  tempRoots.push(root);
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(
    join(root, "index.html"),
    '<!doctype html><html><body><div id="root">Specflow</div></body></html>',
    "utf8"
  );

  return root;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

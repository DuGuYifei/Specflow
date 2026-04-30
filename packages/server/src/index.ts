import { access, readFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import {
  FileWorkflowRunStore,
  createPhase1LocalLoopGraph,
  createLocalWorkflowRun,
  executeLocalWorkflowRun,
  validateGraph,
  validateLocalPlaceholderRuntimeGraph,
  type GraphDefinition,
  type GraphValidationIssue,
  type GraphValidationResult,
  type TicketInput
} from "@specflow/runtime";
import {
  CONTINUOUS_CODING_CATEGORY,
  LOCAL_FOUNDATION_STATUS,
  formatDefaultWorkflowFlow
} from "@specflow/shared";
import { readSpecflowWorkflowDefinitions } from "@specflow/specflow";

export interface BuildServerOptions {
  root?: string;
  uiDistPath?: string;
  stepDelayMs?: number;
}

interface CreateRunBody {
  ticket?: string;
  workflowDefinitionId?: string;
  maxRepairAttempts?: number;
}

interface WorkflowDefinitionSummary {
  source: "repository" | "builtin";
  path?: string;
  definition: GraphDefinition;
  validation: GraphValidationResult;
}

const defaultHost = "127.0.0.1";
const defaultPort = 3000;

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const server = Fastify({
    logger: true
  });
  const uiDistPath = options.uiDistPath ?? defaultUiDistPath();
  const stepDelayMs = options.stepDelayMs ?? 600;

  server.get("/health", async () => ({
    status: "ok",
    service: "specflow-server"
  }));

  server.get("/api/project", async () => ({
    name: "Specflow",
    category: CONTINUOUS_CODING_CATEGORY,
    status: LOCAL_FOUNDATION_STATUS,
    flow: formatDefaultWorkflowFlow(),
    runtime: "placeholder"
  }));

  server.get("/api/workflows", async () => {
    const root = await resolveRoot(options.root);

    return {
      workflows: await listWorkflowDefinitions(root)
    };
  });

  server.get("/api/runs", async () => {
    const root = await resolveRoot(options.root);
    const store = new FileWorkflowRunStore(root);

    return {
      runs: await store.listRuns()
    };
  });

  server.get<{ Params: { runId: string } }>("/api/runs/:runId", async (request) => {
    const root = await resolveRoot(options.root);
    const store = new FileWorkflowRunStore(root);

    return {
      run: await store.readRun(request.params.runId)
    };
  });

  server.get<{ Params: { runId: string; artifactId: string } }>(
    "/api/runs/:runId/artifacts/:artifactId",
    async (request) => {
      const root = await resolveRoot(options.root);
      const store = new FileWorkflowRunStore(root);

      return {
        artifact: await store.readArtifact(
          request.params.runId,
          request.params.artifactId
        )
      };
    }
  );

  server.post<{ Body: CreateRunBody }>("/api/runs", async (request, reply) => {
    const ticketBody = request.body?.ticket?.trim();

    if (!ticketBody) {
      return reply.code(400).send({
        error: "ticket is required"
      });
    }

    const root = await resolveRoot(options.root);
    const store = new FileWorkflowRunStore(root);
    const selectedWorkflow = await resolveWorkflowDefinition(
      root,
      request.body?.workflowDefinitionId
    );

    if (!selectedWorkflow.ok) {
      return reply.code(400).send({
        error: selectedWorkflow.error,
        issues: selectedWorkflow.issues
      });
    }

    const ticket: TicketInput = {
      body: ticketBody,
      source: "inline"
    };
    const run = await createLocalWorkflowRun({
      root,
      ticket,
      workflowDefinition: selectedWorkflow.workflow.definition,
      workflowDefinitionPath: selectedWorkflow.workflow.path,
      workflowDefinitionSource: selectedWorkflow.workflow.source,
      maxRepairAttempts: request.body?.maxRepairAttempts,
      store
    });

    void executeLocalWorkflowRun({
      root,
      runId: run.id,
      stepDelayMs,
      store
    }).catch((error: unknown) => {
      request.log.error({ error }, "workflow run failed");
    });

    return reply.code(202).send({
      runId: run.id,
      run
    });
  });

  server.get("/", async (_request, reply) => {
    const html = await readFile(join(uiDistPath, "index.html"), "utf8");

    return reply.type("text/html").send(html);
  });

  server.get<{ Params: { path: string } }>("/assets/:path", async (request, reply) => {
    const assetPath = join(uiDistPath, "assets", request.params.path);
    const content = await readFile(assetPath);

    return reply.type(contentTypeFor(assetPath)).send(content);
  });

  return server;
}

export async function startServer(
  options: {
    root?: string;
    host?: string;
    port?: number;
    stepDelayMs?: number;
  } = {}
): Promise<FastifyInstance> {
  const server = buildServer({
    root: options.root,
    stepDelayMs: options.stepDelayMs
  });

  await server.listen({
    host: options.host ?? defaultHost,
    port: options.port ?? defaultPort
  });

  return server;
}

async function start(): Promise<void> {
  const port = Number(process.env.PORT ?? defaultPort);
  const host = process.env.HOST ?? defaultHost;

  await startServer({ port, host });
}

async function resolveRoot(root?: string): Promise<string> {
  return root ?? findRepositoryRoot();
}

async function listWorkflowDefinitions(
  root: string
): Promise<WorkflowDefinitionSummary[]> {
  const workflowDefinitions = await readSpecflowWorkflowDefinitions(root);

  if (workflowDefinitions.length > 0) {
    return workflowDefinitions.map((workflow) => ({
      source: "repository" as const,
      path: workflow.path,
      definition: workflow.definition,
      validation: validateGraph(workflow.definition)
    }));
  }

  const definition = createPhase1LocalLoopGraph();

  return [
    {
      source: "builtin",
      path: undefined,
      definition,
      validation: validateGraph(definition)
    }
  ];
}

async function resolveWorkflowDefinition(
  root: string,
  workflowDefinitionId?: string
): Promise<
  | { ok: true; workflow: WorkflowDefinitionSummary }
  | { ok: false; error: string; issues?: GraphValidationIssue[] }
> {
  const workflows = await listWorkflowDefinitions(root);
  const workflow = workflowDefinitionId
    ? workflows.find((candidate) => candidate.definition.id === workflowDefinitionId)
    : workflows[0];

  if (!workflow) {
    return {
      ok: false,
      error: workflowDefinitionId
        ? `Workflow definition not found: ${workflowDefinitionId}`
        : "No workflow definition is available."
    };
  }

  if (!workflow.validation.valid) {
    return {
      ok: false,
      error: `Workflow definition is invalid: ${formatValidationIssues(
        workflow.validation.issues
      )}`,
      issues: workflow.validation.issues
    };
  }

  const runtimeCompatibility = validateLocalPlaceholderRuntimeGraph(
    workflow.definition
  );

  if (!runtimeCompatibility.valid) {
    return {
      ok: false,
      error: `Workflow definition is valid but not executable by the current placeholder runtime. ${formatValidationIssues(
        runtimeCompatibility.issues
      )}`,
      issues: runtimeCompatibility.issues
    };
  }

  return { ok: true, workflow };
}

function formatValidationIssues(issues: GraphValidationIssue[]): string {
  return issues.map((issue) => issue.message).join("; ");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findRepositoryRoot(start = process.cwd()): Promise<string> {
  let current = start;

  while (true) {
    if (
      (await pathExists(join(current, "pnpm-workspace.yaml"))) &&
      (await pathExists(join(current, ".specflow")))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current || parse(current).root === current) {
      throw new Error("Specflow repository root not found.");
    }
    current = parent;
  }
}

function defaultUiDistPath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "ui",
    "dist",
    "panel"
  );
}

function contentTypeFor(path: string): string {
  if (path.endsWith(".css")) {
    return "text/css";
  }

  if (path.endsWith(".js")) {
    return "text/javascript";
  }

  if (path.endsWith(".svg")) {
    return "image/svg+xml";
  }

  return "application/octet-stream";
}

const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  await start();
}

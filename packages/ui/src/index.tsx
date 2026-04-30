import "@xyflow/react/dist/style.css";
import "./styles.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node
} from "@xyflow/react";

type RunStatus = "created" | "running" | "completed" | "failed" | "cancelled";
type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";
type EdgeType = "control_flow" | "data_flow" | "review_loop" | "control_scope";

interface WorkflowRun {
  id: string;
  workflowDefinition: WorkflowDefinitionRef;
  status: RunStatus;
  ticket: {
    id: string;
    body: string;
    source: "inline" | "file";
    createdAt: string;
  };
  sessionGroups?: WorkflowSessionGroup[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  nodeExecutions: NodeExecutionState[];
  sessions?: WorkflowSession[];
  controlDecisions?: WorkflowControlDecision[];
  artifacts: WorkflowArtifact[];
  reviews: unknown[];
  createdAt: string;
  updatedAt: string;
  maxRepairAttempts: number;
}

interface WorkflowDefinitionRef {
  id: string;
  name: string;
  source: "repository" | "builtin";
  version?: string;
  path?: string;
}

interface WorkflowNode {
  id: string;
  type: string;
  label: string;
  status: string;
  role?: string;
  agentCli?: {
    cli: string;
    args: string[];
  };
  session?: NodeSessionPolicy;
  control?: NodeControlScope;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
}

interface WorkflowDefinition {
  id: string;
  name: string;
  version?: string;
  description?: string;
  entryNodeId?: string;
  sessionGroups?: WorkflowSessionGroup[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

interface WorkflowSessionGroup {
  id: string;
  label: string;
  description?: string;
  controllerNodeId?: string;
}

interface WorkflowValidationIssue {
  message: string;
  nodeId?: string;
  edgeId?: string;
}

interface WorkflowValidationResult {
  valid: boolean;
  issues: WorkflowValidationIssue[];
}

interface WorkflowDefinitionSummary {
  source: "repository" | "builtin";
  path?: string;
  definition: WorkflowDefinition;
  validation: WorkflowValidationResult;
  runtimeCompatibility: WorkflowValidationResult;
}

interface NodeExecutionState {
  nodeId: string;
  nodeType: string;
  label: string;
  status: NodeStatus;
  executionMode: "system" | "agent";
  agentCli?: {
    cli: string;
    args: string[];
  };
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  attempts: number;
  sessionId?: string;
  sessionIds?: string[];
  error?: string;
}

interface NodeSessionPolicy {
  mode: "none" | "shared" | "fresh" | "ai_decides";
  groupId?: string;
  label?: string;
  controllerNodeId?: string;
  newSessionOnLoop?: boolean;
}

interface NodeControlScope {
  managedNodeIds: string[];
  decisionKinds: string[];
}

interface WorkflowSession {
  id: string;
  runId: string;
  groupId: string;
  label: string;
  status: "open" | "closed";
  agentCli: {
    cli: string;
    args: string[];
  };
  controlledByNodeId?: string;
  nodeIds: string[];
  artifactIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface WorkflowControlDecision {
  id: string;
  runId: string;
  controllerNodeId: string;
  kind: string;
  targetNodeIds: string[];
  summary: string;
  sessionDecisions?: Array<{
    targetNodeId: string;
    sessionGroupId: string;
    openNewSession: boolean;
    reason: string;
  }>;
  createdAt: string;
}

interface WorkflowArtifact {
  id: string;
  runId: string;
  nodeId: string;
  kind: string;
  title: string;
  content: string;
  contentType: "application/json" | "text/markdown" | "text/plain";
  createdAt: string;
}

interface RunsResponse {
  runs: WorkflowRun[];
}

interface RunResponse {
  run: WorkflowRun;
}

interface ArtifactResponse {
  artifact: WorkflowArtifact;
}

interface CreateRunResponse {
  runId: string;
}

interface WorkflowsResponse {
  workflows: WorkflowDefinitionSummary[];
}

interface ApiErrorResponse {
  error?: string;
  issues?: WorkflowValidationIssue[];
}

interface WorkflowReadiness {
  runnable: boolean;
  label: string;
  message?: string;
}

const nodePositions: Record<string, { x: number; y: number }> = {
  "ticket-input": { x: 0, y: 150 },
  "spec-context": { x: 230, y: 150 },
  "session-director": { x: 460, y: 150 },
  plan: { x: 690, y: 150 },
  "code-draft": { x: 920, y: 150 },
  "implementation-review": { x: 1150, y: 150 },
  "repair-loop": { x: 1150, y: 330 },
  "final-patch": { x: 1380, y: 150 }
};

export function WorkflowPanel() {
  const [workflowDefinitions, setWorkflowDefinitions] = useState<
    WorkflowDefinitionSummary[]
  >([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [selectedRun, setSelectedRun] = useState<WorkflowRun>();
  const [selectedWorkflowDefinitionId, setSelectedWorkflowDefinitionId] =
    useState<string>();
  const [selectedNodeId, setSelectedNodeId] = useState("ticket-input");
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>();
  const [selectedArtifact, setSelectedArtifact] = useState<WorkflowArtifact>();
  const [ticket, setTicket] = useState("");
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [error, setError] = useState<string>();

  const selectedWorkflowDefinition = useMemo(
    () =>
      workflowDefinitions.find(
        (workflow) => workflow.definition.id === selectedWorkflowDefinitionId
      ) ?? workflowDefinitions[0],
    [selectedWorkflowDefinitionId, workflowDefinitions]
  );
  const selectedWorkflowReadiness = workflowReadiness(selectedWorkflowDefinition);
  const draftRun = useMemo(
    () => createDraftRun(selectedWorkflowDefinition?.definition),
    [selectedWorkflowDefinition]
  );
  const visibleRun = selectedRun ?? draftRun;
  const visibleWorkflowDefinition =
    selectedRun?.workflowDefinition ??
    (selectedWorkflowDefinition
      ? toWorkflowDefinitionRef(selectedWorkflowDefinition)
      : undefined);
  const visibleWorkflowRuntimeLabel = selectedRun
    ? "bound"
    : selectedWorkflowReadiness.label;
  const selectedExecution = visibleRun.nodeExecutions.find(
    (execution) => execution.nodeId === selectedNodeId
  );
  const selectedNode = visibleRun.nodes.find((node) => node.id === selectedNodeId);
  const selectedSession = selectedExecution?.sessionId
    ? visibleRun.sessions?.find((session) => session.id === selectedExecution.sessionId)
    : undefined;
  const controllerDecisions =
    visibleRun.controlDecisions?.filter(
      (decision) => decision.controllerNodeId === selectedNodeId
    ) ?? [];
  const sessionPlans = useMemo(() => mapSessionPlans(visibleRun), [visibleRun]);
  const outputArtifacts = selectedExecution
    ? visibleRun.artifacts.filter((artifact) =>
        selectedExecution.outputArtifactIds.includes(artifact.id)
      )
    : [];

  const refreshRuns = useCallback(async () => {
    const response = await fetch("/api/runs");
    const payload = (await response.json()) as RunsResponse;

    setRuns(payload.runs);
    setSelectedRunId((current) => current ?? payload.runs[0]?.id);
  }, []);

  const refreshWorkflowDefinitions = useCallback(async () => {
    const response = await fetch("/api/workflows");

    if (!response.ok) {
      throw new Error(`Workflow request failed: ${response.status}`);
    }

    const payload = (await response.json()) as WorkflowsResponse;
    setWorkflowDefinitions(payload.workflows);
  }, []);

  const refreshSelectedRun = useCallback(async () => {
    if (!selectedRunId) {
      setSelectedRun(undefined);
      return;
    }

    const response = await fetch(`/api/runs/${selectedRunId}`);

    if (!response.ok) {
      setSelectedRun(undefined);
      return;
    }

    const payload = (await response.json()) as RunResponse;
    setSelectedRun(payload.run);
  }, [selectedRunId]);

  useEffect(() => {
    void refreshWorkflowDefinitions().catch((caughtError: unknown) => {
      setError(formatError(caughtError));
    });
    void refreshRuns().catch((caughtError: unknown) => {
      setError(formatError(caughtError));
    });
  }, [refreshRuns, refreshWorkflowDefinitions]);

  useEffect(() => {
    if (workflowDefinitions.length === 0) {
      setSelectedWorkflowDefinitionId(undefined);
      return;
    }

    if (
      !selectedWorkflowDefinitionId ||
      !workflowDefinitions.some(
        (workflow) => workflow.definition.id === selectedWorkflowDefinitionId
      )
    ) {
      setSelectedWorkflowDefinitionId(workflowDefinitions[0]?.definition.id);
    }
  }, [selectedWorkflowDefinitionId, workflowDefinitions]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshRuns().catch((caughtError: unknown) => {
        setError(formatError(caughtError));
      });
    }, 1500);

    return () => {
      window.clearInterval(interval);
    };
  }, [refreshRuns]);

  useEffect(() => {
    void refreshSelectedRun().catch((caughtError: unknown) => {
      setError(formatError(caughtError));
    });
  }, [refreshSelectedRun]);

  useEffect(() => {
    if (!selectedRunId || isTerminalRun(selectedRun)) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshSelectedRun().catch((caughtError: unknown) => {
        setError(formatError(caughtError));
      });
    }, 800);

    return () => {
      window.clearInterval(interval);
    };
  }, [refreshSelectedRun, selectedRun, selectedRunId]);

  useEffect(() => {
    if (!selectedArtifactId || !selectedRunId) {
      setSelectedArtifact(undefined);
      return;
    }

    void fetch(`/api/runs/${selectedRunId}/artifacts/${selectedArtifactId}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Artifact request failed: ${response.status}`);
        }

        return (await response.json()) as ArtifactResponse;
      })
      .then((payload) => {
        setSelectedArtifact(payload.artifact);
      })
      .catch((caughtError: unknown) => {
        setError(formatError(caughtError));
      });
  }, [selectedArtifactId, selectedRunId]);

  useEffect(() => {
    if (
      !selectedArtifactId ||
      outputArtifacts.some((artifact) => artifact.id === selectedArtifactId)
    ) {
      return;
    }

    setSelectedArtifactId(undefined);
  }, [outputArtifacts, selectedArtifactId]);

  const nodes = useMemo(
    () => mapRunNodes(visibleRun, selectedNodeId),
    [selectedNodeId, visibleRun]
  );
  const edges = useMemo(() => mapRunEdges(visibleRun.edges), [visibleRun.edges]);

  async function createRun(): Promise<void> {
    const body = ticket.trim();

    if (!body) {
      setError("Ticket is required.");
      return;
    }

    if (!selectedWorkflowReadiness.runnable) {
      setError(selectedWorkflowReadiness.message ?? "Workflow is not runnable.");
      return;
    }

    setIsCreatingRun(true);
    setError(undefined);

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          ticket: body,
          workflowDefinitionId: selectedWorkflowDefinition?.definition.id
        })
      });

      if (!response.ok) {
        throw new Error(await responseErrorMessage(response, "Run request failed"));
      }

      const payload = (await response.json()) as CreateRunResponse;
      setSelectedRunId(payload.runId);
      setSelectedNodeId("ticket-input");
      setSelectedArtifactId(undefined);
      setTicket("");
      await refreshRuns();
    } catch (caughtError) {
      setError(formatError(caughtError));
    } finally {
      setIsCreatingRun(false);
    }
  }

  return (
    <main className="studio-shell">
      <aside className="run-rail" aria-label="Workflow runs">
        <div className="brand-lockup">
          <span className="brand-mark">S</span>
          <div>
            <p className="eyebrow">Specflow</p>
            <h1>Local Loop</h1>
          </div>
        </div>
        <div className="rail-section">
          <p className="section-label">Workflow</p>
          {workflowDefinitions.length > 0 ? (
            <div className="definition-list">
              {workflowDefinitions.map((workflow) => {
                const readiness = workflowReadiness(workflow);

                return (
                  <button
                    className={`definition-item ${
                      workflow.definition.id ===
                      selectedWorkflowDefinition?.definition.id
                        ? "is-selected"
                        : ""
                    } ${readiness.runnable ? "" : "is-blocked"}`}
                    key={`${workflow.source}:${workflow.definition.id}`}
                    onClick={() => {
                      setSelectedWorkflowDefinitionId(workflow.definition.id);
                      setSelectedRunId(undefined);
                      setSelectedRun(undefined);
                      setSelectedNodeId("ticket-input");
                      setSelectedArtifactId(undefined);
                    }}
                    type="button"
                  >
                    <span>{workflow.definition.name}</span>
                    <strong>{`${workflow.source} / ${readiness.label}`}</strong>
                    <small>{workflow.path ?? workflow.definition.id}</small>
                    {!readiness.runnable ? <small>{readiness.message}</small> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="muted-line">Loading definition</p>
          )}
        </div>
        <div className="rail-section">
          <p className="section-label">Runs</p>
          <div className="run-list">
            {runs.length === 0 ? (
              <button
                className="run-item is-selected"
                onClick={() => {
                  setSelectedRunId(undefined);
                  setSelectedRun(undefined);
                  setSelectedNodeId("ticket-input");
                }}
                type="button"
              >
                <span className="run-name">New run</span>
                <span className="run-meta">draft</span>
              </button>
            ) : null}
            {runs.map((run) => (
              <button
                className={`run-item ${run.id === selectedRunId ? "is-selected" : ""}`}
                key={run.id}
                onClick={() => {
                  setSelectedRunId(run.id);
                  setSelectedNodeId("ticket-input");
                  setSelectedArtifactId(undefined);
                }}
                type="button"
              >
                <span className="run-name">{shortId(run.id)}</span>
                <span className={`run-state state-${run.status}`}>{run.status}</span>
                <span className="run-meta">{formatTime(run.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="canvas-zone">
        <header className="console-header">
          <div>
            <p className="eyebrow">Workflow graph</p>
            <h2>{selectedRun ? shortId(selectedRun.id) : "Draft run"}</h2>
          </div>
          <div className={`status-pill state-${visibleRun.status}`}>
            {visibleRun.status}
          </div>
        </header>
        <div className="graph-surface" aria-label="Workflow graph canvas">
          <ReactFlow
            edges={edges}
            fitView
            nodes={nodes}
            nodesConnectable={false}
            nodesDraggable={false}
            onNodeClick={(_event, node) => {
              setSelectedNodeId(node.id);
              setSelectedArtifactId(undefined);
            }}
          >
            <Background color="#26333c" gap={22} />
            <Controls showInteractive={false} />
            <MiniMap pannable={false} zoomable={false} />
          </ReactFlow>
        </div>
      </section>

      <aside className="inspector" aria-label="Node inspector">
        <div className="inspector-header">
          <p className="eyebrow">Inspector</p>
          <h2>{selectedNode?.label ?? "Ticket Input"}</h2>
        </div>

        {selectedNodeId === "ticket-input" ? (
          <section className="inspector-section">
            <label className="field-label" htmlFor="ticket-input">
              Ticket
            </label>
            <textarea
              className="ticket-textarea"
              id="ticket-input"
              onChange={(event) => {
                setTicket(event.target.value);
              }}
              spellCheck={false}
              value={ticket}
            />
            <button
              className="primary-action"
              disabled={
                isCreatingRun ||
                ticket.trim().length === 0 ||
                !selectedWorkflowReadiness.runnable
              }
              onClick={() => void createRun()}
              type="button"
            >
              {isCreatingRun ? "Starting" : "Run"}
            </button>
            {!selectedWorkflowReadiness.runnable ? (
              <p className="workflow-warning">{selectedWorkflowReadiness.message}</p>
            ) : null}
          </section>
        ) : null}

        <section className="inspector-section">
          <div className="detail-grid">
            <span>workflow</span>
            <strong>{visibleWorkflowDefinition?.name ?? "unknown"}</strong>
            <span>source</span>
            <strong>
              {visibleWorkflowDefinition
                ? workflowDefinitionSourceLabel(visibleWorkflowDefinition)
                : "unknown"}
            </strong>
            <span>runtime</span>
            <strong>{visibleWorkflowRuntimeLabel}</strong>
            <span>node</span>
            <strong>{selectedNodeId}</strong>
            <span>status</span>
            <strong>{selectedExecution?.status ?? "pending"}</strong>
            <span>role</span>
            <strong>{selectedNode?.role ?? selectedNode?.type ?? "unknown"}</strong>
            <span>mode</span>
            <strong>{executionModeLabel(selectedExecution)}</strong>
            {selectedExecution?.agentCli ? (
              <>
                <span>agent args</span>
                <strong>{agentArgsLabel(selectedExecution.agentCli.args)}</strong>
              </>
            ) : null}
            <span>session</span>
            <strong>{sessionPolicyLabel(selectedNode)}</strong>
            <span>active</span>
            <strong>{selectedSession ? shortId(selectedSession.id) : "none"}</strong>
            <span>attempts</span>
            <strong>{selectedExecution?.attempts ?? 0}</strong>
            {selectedNode?.control ? (
              <>
                <span>manages</span>
                <strong>{selectedNode.control.managedNodeIds.join(", ")}</strong>
              </>
            ) : null}
          </div>
        </section>

        {sessionPlans.length > 0 ? (
          <section className="inspector-section">
            <p className="section-label">Session plan</p>
            <div className="session-plan-list">
              {sessionPlans.map((plan) => (
                <div className="session-plan-item" key={plan.group.id}>
                  <span>{plan.group.label}</span>
                  <strong>{plan.group.id}</strong>
                  <small>{plan.nodeLabels.join(", ")}</small>
                  {plan.controllerLabel ? (
                    <small>controlled by {plan.controllerLabel}</small>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {controllerDecisions.length > 0 ? (
          <section className="inspector-section">
            <p className="section-label">Director decisions</p>
            <div className="decision-list">
              {controllerDecisions.map((decision) => (
                <div className="decision-item" key={decision.id}>
                  <strong>{decision.kind}</strong>
                  <span>{decision.summary}</span>
                  <small>
                    {decision.targetNodeIds
                      .map((nodeId) => nodeDisplayLabel(visibleRun, nodeId))
                      .join(", ")}
                  </small>
                  {(decision.sessionDecisions?.length ?? 0) > 0 ? (
                    <div className="decision-detail-list">
                      {decision.sessionDecisions?.map((sessionDecision) => (
                        <div
                          className="decision-detail-item"
                          key={`${decision.id}:${sessionDecision.targetNodeId}`}
                        >
                          <strong>
                            {nodeDisplayLabel(visibleRun, sessionDecision.targetNodeId)}
                          </strong>
                          <small>
                            {sessionDecision.openNewSession ? "new" : "reuse"} /{" "}
                            {sessionDecision.sessionGroupId}
                          </small>
                          <span>{sessionDecision.reason}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {(visibleRun.sessions?.length ?? 0) > 0 ? (
          <section className="inspector-section">
            <p className="section-label">Sessions</p>
            <div className="session-list">
              {visibleRun.sessions?.map((session) => (
                <div
                  className={`session-item ${
                    session.id === selectedSession?.id ? "is-selected" : ""
                  }`}
                  key={session.id}
                >
                  <span>{session.label}</span>
                  <strong>{shortId(session.id)}</strong>
                  <small>
                    {session.agentCli.cli} / {session.nodeIds.join(", ")}
                  </small>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {selectedExecution?.error ? (
          <section className="inspector-section error-panel">
            <p>{selectedExecution.error}</p>
          </section>
        ) : null}

        <section className="inspector-section">
          <p className="section-label">Artifacts</p>
          <div className="artifact-list">
            {outputArtifacts.length === 0 ? (
              <p className="muted-line">No artifacts</p>
            ) : null}
            {outputArtifacts.map((artifact) => (
              <button
                className={`artifact-item ${
                  artifact.id === selectedArtifactId ? "is-selected" : ""
                }`}
                key={artifact.id}
                onClick={() => {
                  setSelectedArtifactId(artifact.id);
                }}
                type="button"
              >
                <span>{artifact.title}</span>
                <small>{artifact.kind}</small>
              </button>
            ))}
          </div>
        </section>

        {selectedArtifact ? (
          <section className="inspector-section artifact-preview">
            <div className="preview-header">
              <span>{selectedArtifact.kind}</span>
              <small>{selectedArtifact.contentType}</small>
            </div>
            <pre>{formatArtifactContent(selectedArtifact)}</pre>
          </section>
        ) : null}

        {error ? (
          <section className="inspector-section error-panel">
            <p>{error}</p>
          </section>
        ) : null}
      </aside>
    </main>
  );
}

function mapRunNodes(run: WorkflowRun, selectedNodeId: string): Node[] {
  return run.nodes.map((node, index) => {
    const execution = run.nodeExecutions.find(
      (candidate) => candidate.nodeId === node.id
    );
    const status = execution?.status ?? "pending";
    const outputCount = execution?.outputArtifactIds.length ?? 0;
    const mode = executionModeLabel(execution);
    const role = node.role ?? node.type;
    const session = node.session?.label ?? node.session?.groupId ?? "no session";

    return {
      id: node.id,
      position: nodePositions[node.id] ?? { x: index * 230, y: 150 },
      className: `workflow-node node-role-${role} state-${status} ${
        selectedNodeId === node.id ? "is-selected" : ""
      }`,
      data: {
        label: (
          <div className="node-card">
            <div className="node-card-top">
              <span>{node.label}</span>
              <span className={`node-status state-${status}`}>{status}</span>
            </div>
            <div className="node-card-middle">
              <span>{role}</span>
              <span>{session}</span>
            </div>
            <div className="node-card-bottom">
              <span>{mode}</span>
              <span>{outputCount} artifacts</span>
            </div>
          </div>
        )
      },
      type:
        node.id === "ticket-input"
          ? "input"
          : node.id === "final-patch"
            ? "output"
            : undefined
    };
  });
}

function mapRunEdges(edges: WorkflowEdge[]): Edge[] {
  return edges.map((edge) => {
    const isReview = edge.type === "review_loop";
    const isScope = edge.type === "control_scope";

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label ?? (isReview ? "review loop" : undefined),
      markerEnd: { type: MarkerType.ArrowClosed },
      className: isScope ? "scope-edge" : isReview ? "review-edge" : "control-edge",
      style: {
        strokeWidth: isReview || isScope ? 2.4 : 2,
        stroke: isScope ? "#7fb86a" : isReview ? "#d5963d" : "#5c7c8f",
        strokeDasharray: isReview || isScope ? "7 5" : undefined
      },
      labelStyle: {
        fill: isScope ? "#a8d88f" : "#d5963d",
        fontWeight: 700
      }
    };
  });
}

interface SessionPlan {
  group: WorkflowSessionGroup;
  nodeLabels: string[];
  controllerLabel?: string;
}

function mapSessionPlans(run: WorkflowRun): SessionPlan[] {
  const groups = run.sessionGroups ?? inferSessionGroups(run.nodes);

  return groups
    .map((group) => {
      const nodes = run.nodes.filter((node) => node.session?.groupId === group.id);
      const controller = group.controllerNodeId
        ? run.nodes.find((node) => node.id === group.controllerNodeId)
        : undefined;

      return {
        group,
        nodeLabels: nodes.map((node) => node.label),
        controllerLabel: controller?.label
      };
    })
    .filter((plan) => plan.nodeLabels.length > 0);
}

function inferSessionGroups(nodes: WorkflowNode[]): WorkflowSessionGroup[] {
  const groups = new Map<string, WorkflowSessionGroup>();

  for (const node of nodes) {
    const policy = node.session;

    if (!policy?.groupId || groups.has(policy.groupId)) {
      continue;
    }

    groups.set(policy.groupId, {
      id: policy.groupId,
      label: policy.label ?? policy.groupId,
      controllerNodeId: policy.controllerNodeId
    });
  }

  return [...groups.values()];
}

function nodeDisplayLabel(run: WorkflowRun, nodeId: string): string {
  return run.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function createDraftRun(definition?: WorkflowDefinition): WorkflowRun {
  const now = new Date().toISOString();
  const managedNodeIds = [
    "plan",
    "code-draft",
    "implementation-review",
    "repair-loop",
    "final-patch"
  ];
  const nodes: WorkflowRun["nodes"] = definition?.nodes ?? [
    {
      id: "ticket-input",
      type: "ticket",
      label: "Ticket Input",
      status: "pending",
      role: "input",
      session: { mode: "none" }
    },
    {
      id: "spec-context",
      type: "spec_context",
      label: "Spec Context",
      status: "pending",
      role: "context",
      session: { mode: "none" }
    },
    {
      id: "session-director",
      type: "workflow_director",
      label: "Session Director",
      status: "pending",
      role: "director",
      agentCli: { cli: "codex", args: [] },
      session: {
        mode: "fresh",
        groupId: "direction",
        label: "Direction"
      },
      control: {
        managedNodeIds,
        decisionKinds: ["session"]
      }
    },
    {
      id: "plan",
      type: "plan",
      label: "Plan",
      status: "pending",
      role: "worker",
      agentCli: { cli: "codex", args: [] },
      session: {
        mode: "ai_decides",
        groupId: "implementation",
        label: "Implementation",
        controllerNodeId: "session-director"
      }
    },
    {
      id: "code-draft",
      type: "code_draft",
      label: "Code Draft",
      status: "pending",
      role: "worker",
      agentCli: { cli: "codex", args: [] },
      session: {
        mode: "ai_decides",
        groupId: "implementation",
        label: "Implementation",
        controllerNodeId: "session-director"
      }
    },
    {
      id: "implementation-review",
      type: "implementation_reviewer",
      label: "Implementation Review",
      status: "pending",
      role: "reviewer",
      agentCli: { cli: "codex", args: [] },
      session: {
        mode: "ai_decides",
        groupId: "review",
        label: "Review",
        controllerNodeId: "session-director",
        newSessionOnLoop: true
      }
    },
    {
      id: "repair-loop",
      type: "repair",
      label: "Repair Loop",
      status: "pending",
      role: "worker",
      agentCli: { cli: "codex", args: [] },
      session: {
        mode: "ai_decides",
        groupId: "implementation",
        label: "Implementation",
        controllerNodeId: "session-director",
        newSessionOnLoop: true
      }
    },
    {
      id: "final-patch",
      type: "final_patch",
      label: "Final Patch",
      status: "pending",
      role: "output",
      agentCli: { cli: "codex", args: [] },
      session: {
        mode: "ai_decides",
        groupId: "implementation",
        label: "Implementation",
        controllerNodeId: "session-director"
      }
    }
  ];

  return {
    id: "draft",
    workflowDefinition: {
      id: definition?.id ?? "phase-1-local-loop",
      name: definition?.name ?? "Phase 1 Local Loop",
      source: "builtin",
      version: definition?.version
    },
    ticket: {
      id: "draft-ticket",
      body: "",
      source: "inline",
      createdAt: now
    },
    status: "created",
    sessionGroups: definition?.sessionGroups ?? [
      {
        id: "direction",
        label: "Direction",
        controllerNodeId: "session-director"
      },
      {
        id: "implementation",
        label: "Implementation",
        controllerNodeId: "session-director"
      },
      {
        id: "review",
        label: "Review",
        controllerNodeId: "session-director"
      }
    ],
    nodes,
    edges: definition?.edges ?? [
      {
        id: "ticket-spec-context",
        source: "ticket-input",
        target: "spec-context",
        type: "control_flow"
      },
      {
        id: "spec-context-session-director",
        source: "spec-context",
        target: "session-director",
        type: "control_flow"
      },
      {
        id: "session-director-plan",
        source: "session-director",
        target: "plan",
        type: "control_flow"
      },
      {
        id: "plan-code-draft",
        source: "plan",
        target: "code-draft",
        type: "control_flow"
      },
      {
        id: "code-draft-review",
        source: "code-draft",
        target: "implementation-review",
        type: "control_flow"
      },
      {
        id: "review-repair",
        source: "implementation-review",
        target: "repair-loop",
        type: "review_loop"
      },
      {
        id: "repair-review",
        source: "repair-loop",
        target: "implementation-review",
        type: "review_loop"
      },
      {
        id: "review-final-patch",
        source: "implementation-review",
        target: "final-patch",
        type: "control_flow"
      },
      ...managedNodeIds.map((nodeId) => ({
        id: `session-director-manages-${nodeId}`,
        source: "session-director",
        target: nodeId,
        type: "control_scope" as const,
        label: "manages session"
      }))
    ],
    nodeExecutions: nodes.map((node) => ({
      nodeId: node.id,
      nodeType: node.type,
      label: node.label,
      status: "pending",
      executionMode: draftNodeExecutionMode(node),
      agentCli:
        draftNodeExecutionMode(node) === "agent"
          ? draftAgentCliForNode(node)
          : undefined,
      inputArtifactIds: [],
      outputArtifactIds: [],
      attempts: 0,
      sessionIds: []
    })),
    sessions: [],
    controlDecisions: [],
    artifacts: [],
    reviews: [],
    createdAt: now,
    updatedAt: now,
    maxRepairAttempts: 1
  };
}

function executionModeLabel(execution?: NodeExecutionState): string {
  if (!execution) {
    return "system";
  }

  return execution.executionMode === "agent"
    ? `agent:${execution.agentCli?.cli ?? "unknown"}`
    : "system";
}

function agentArgsLabel(args: string[]): string {
  return args.length > 0 ? args.join(" ") : "none";
}

function draftNodeExecutionMode(node: WorkflowNode): "system" | "agent" {
  return node.type === "ticket" || node.type === "spec_context" ? "system" : "agent";
}

function draftAgentCliForNode(node: WorkflowNode): { cli: string; args: string[] } {
  const agentCli = node.agentCli ?? { cli: "codex", args: [] };

  return {
    cli: agentCli.cli,
    args: [...agentCli.args]
  };
}

function sessionPolicyLabel(node?: WorkflowNode): string {
  const policy = node?.session;

  if (!policy || policy.mode === "none") {
    return "none";
  }

  const group = policy.label ?? policy.groupId ?? "session";
  const loop = policy.newSessionOnLoop ? " / new on loop" : "";

  return `${group}:${policy.mode}${loop}`;
}

function toWorkflowDefinitionRef(
  workflow: WorkflowDefinitionSummary
): WorkflowDefinitionRef {
  return {
    id: workflow.definition.id,
    name: workflow.definition.name,
    source: workflow.source,
    version: workflow.definition.version,
    path: workflow.path
  };
}

function workflowReadiness(workflow?: WorkflowDefinitionSummary): WorkflowReadiness {
  if (!workflow) {
    return {
      runnable: false,
      label: "loading",
      message: "Workflow definition is loading."
    };
  }

  if (!workflow.validation.valid) {
    return {
      runnable: false,
      label: "invalid",
      message:
        firstValidationIssue(workflow.validation) ?? "Workflow definition is invalid."
    };
  }

  if (!workflow.runtimeCompatibility.valid) {
    return {
      runnable: false,
      label: "blocked",
      message:
        firstValidationIssue(workflow.runtimeCompatibility) ??
        "Workflow is not executable by the current runtime."
    };
  }

  return {
    runnable: true,
    label: "runnable"
  };
}

function firstValidationIssue(result: WorkflowValidationResult): string | undefined {
  return result.issues[0]?.message;
}

function workflowDefinitionSourceLabel(definition: WorkflowDefinitionRef): string {
  return definition.path
    ? `${definition.source}:${definition.path}`
    : definition.source;
}

function isTerminalRun(run?: WorkflowRun): boolean {
  return (
    run?.status === "completed" ||
    run?.status === "failed" ||
    run?.status === "cancelled"
  );
}

function shortId(id: string): string {
  if (id === "draft") {
    return "draft";
  }

  return id.slice(0, 12);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatArtifactContent(artifact: WorkflowArtifact): string {
  if (artifact.contentType !== "application/json") {
    return artifact.content;
  }

  try {
    return JSON.stringify(JSON.parse(artifact.content), null, 2);
  } catch {
    return artifact.content;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function responseErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorResponse;
    const error = payload.error ?? `${fallback}: ${response.status}`;
    const issues = payload.issues?.map((issue) => issue.message).join("; ");

    return issues ? `${error} ${issues}` : error;
  } catch {
    return `${fallback}: ${response.status}`;
  }
}

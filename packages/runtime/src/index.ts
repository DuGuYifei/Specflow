import type {
  Ticket,
  WorkflowArtifact,
  WorkflowEdge,
  WorkflowNode,
  WorkflowRun
} from "@specflow/core";

export interface GraphDefinition {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface GraphValidationIssue {
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface GraphValidationResult {
  valid: boolean;
  issues: GraphValidationIssue[];
}

export interface NodeExecutionContext {
  ticket: Ticket;
  artifacts: WorkflowArtifact[];
}

export interface NodeExecutionResult {
  status: "completed" | "blocked";
  artifacts: WorkflowArtifact[];
  message: string;
}

export interface NodeExecutor {
  type: WorkflowNode["type"];
  execute(
    node: WorkflowNode,
    context: NodeExecutionContext
  ): Promise<NodeExecutionResult>;
}

export function validateGraph(graph: GraphDefinition): GraphValidationResult {
  const issues: GraphValidationIssue[] = [];
  const nodeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({ message: `Duplicate node id: ${node.id}`, nodeId: node.id });
    }
    nodeIds.add(node.id);
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) {
      issues.push({
        message: `Edge source does not exist: ${edge.source}`,
        edgeId: edge.id
      });
    }

    if (!nodeIds.has(edge.target)) {
      issues.push({
        message: `Edge target does not exist: ${edge.target}`,
        edgeId: edge.id
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

export function createPhaseZeroGraph(): GraphDefinition {
  const nodes: WorkflowNode[] = [
    { id: "ticket", type: "ticket", label: "Ticket", status: "pending" },
    { id: "interview", type: "interview", label: "Interview", status: "pending" },
    { id: "plan", type: "plan", label: "Plan", status: "pending" },
    { id: "code-draft", type: "code_draft", label: "Code Draft", status: "pending" },
    {
      id: "implementation-review",
      type: "implementation_reviewer",
      label: "Implementation Review",
      status: "pending"
    },
    { id: "repair-loop", type: "repair", label: "Repair Loop", status: "pending" },
    { id: "final-patch", type: "final_patch", label: "Final Patch", status: "pending" }
  ];

  return {
    id: "phase-0-intent",
    name: "Phase 0 Workflow Intent",
    nodes,
    edges: [
      {
        id: "ticket-interview",
        source: "ticket",
        target: "interview",
        type: "control_flow"
      },
      {
        id: "interview-plan",
        source: "interview",
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
      }
    ]
  };
}

export async function executeInMemoryStub(
  ticket: Ticket,
  graph: GraphDefinition = createPhaseZeroGraph()
): Promise<WorkflowRun> {
  const now = new Date().toISOString();

  return {
    id: `stub-${ticket.id}`,
    ticket,
    status: "completed",
    nodes: graph.nodes.map((node) => ({ ...node, status: "completed" })),
    edges: graph.edges,
    artifacts: [
      {
        id: "stub-artifact",
        nodeId: "final-patch",
        kind: "context",
        title: "Phase 0 execution stub",
        content: "No real agent execution runs in Phase 0."
      }
    ],
    reviews: [],
    createdAt: now,
    updatedAt: now
  };
}

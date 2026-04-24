import type { WorkflowEdge, WorkflowNode, WorkflowRun } from '@specflow/core';

export interface WorkflowGraphDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface NodeExecutionContext {
  runId: string;
  node: WorkflowNode;
}

export interface NodeExecutor {
  execute(context: NodeExecutionContext): Promise<{ summary: string }>;
}

export function validateGraph(graph: WorkflowGraphDefinition): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge ${edge.id} has missing source node ${edge.source}`);
    }

    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge ${edge.id} has missing target node ${edge.target}`);
    }
  }

  return errors;
}

export async function executeInMemoryStub(
  run: WorkflowRun,
  executor: NodeExecutor
): Promise<string[]> {
  const summaries: string[] = [];

  for (const node of run.nodes) {
    // TODO(phase-1): replace sequential stub execution with orchestration engine.
    const result = await executor.execute({ runId: run.id, node });
    summaries.push(`${node.id}: ${result.summary}`);
  }

  return summaries;
}

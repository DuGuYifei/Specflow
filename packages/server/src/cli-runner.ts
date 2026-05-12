import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { WorkflowExecutor, type NodeStatusEvent, type RunStatusEvent } from "@specflow/bridge";
import type { WorkflowRun } from "@specflow/workflow";
import type { AgentFlowDoc } from "./canvas-doc";
import { canvasToWorkflow } from "./canvas-to-workflow";

export async function loadAgentFlowFile(filePath: string): Promise<AgentFlowDoc> {
  return parse(await readFile(filePath, "utf8")) as AgentFlowDoc;
}

export async function executeAgentFlowDoc(input: {
  doc: AgentFlowDoc;
  initialInput: string;
  cwd: string;
  onNodeStatus?: (event: NodeStatusEvent) => void;
  onRunStatus?: (event: RunStatusEvent) => void;
}): Promise<WorkflowRun> {
  const workflow = canvasToWorkflow(input.doc);
  const executor = new WorkflowExecutor({
    cwd: input.cwd,
    onNodeStatus: input.onNodeStatus,
    onRunStatus: input.onRunStatus,
  });
  return executor.run(workflow, input.initialInput);
}

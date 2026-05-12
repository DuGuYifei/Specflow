import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { WorkflowExecutor } from "@specflow/bridge";
import type { WorkflowRun } from "@specflow/workflow";
import type { CanvasDoc } from "./canvas-doc";
import { canvasToWorkflow } from "./canvas-to-workflow";

export async function loadCanvasFile(filePath: string): Promise<CanvasDoc> {
  return parse(await readFile(filePath, "utf8")) as CanvasDoc;
}

export async function executeCanvasDoc(input: {
  doc: CanvasDoc;
  initialInput: string;
  cwd: string;
}): Promise<WorkflowRun> {
  const workflow = canvasToWorkflow(input.doc);
  const executor = new WorkflowExecutor({ cwd: input.cwd });
  return executor.run(workflow, input.initialInput);
}

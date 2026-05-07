import { createEmptyWorkflow, type Workflow, type WorkflowRun } from "@specflow/workflow";
import type { BridgeCommand, BridgeCommandResult } from "./commands";
import { TerminalEventStore, WorkflowExecutor } from "./execution";
import { createBridgeRuntime, type BridgeRuntime } from "./runtime";
import { SessionRegistry } from "./sessions";

export interface SpecflowBridge {
  runtime: BridgeRuntime;
  sessions: SessionRegistry;
  workflow: Workflow;
  runs: WorkflowRun[];
  terminalEvents: TerminalEventStore;
  runWorkflow(initialInput?: string): Promise<WorkflowRun>;
  execute(command: BridgeCommand): Promise<BridgeCommandResult>;
}

export function createSpecflowBridge(): SpecflowBridge {
  const workflow = createEmptyWorkflow("New Specflow workflow");
  const defaultAgentId = crypto.randomUUID();
  const defaultSessionId = crypto.randomUUID();
  workflow.agents.push({
    id: defaultAgentId,
    kind: "provider",
    name: "Codex",
    provider: "codex",
  });
  workflow.sessions.push({
    id: defaultSessionId,
    name: "Default Codex session",
    agentId: defaultAgentId,
    createdAt: new Date().toISOString(),
  });

  const terminalEvents = new TerminalEventStore();
  const executor = new WorkflowExecutor({ terminalEvents });

  const bridge: SpecflowBridge = {
    runtime: createBridgeRuntime(),
    sessions: new SessionRegistry(),
    workflow,
    runs: [],
    terminalEvents,
    async runWorkflow(initialInput = "") {
      const run = await executor.run(workflow, initialInput);
      this.runs.push(run);
      return run;
    },
    async execute(command) {
      if (command.name === "workflow.run") {
        const payload = command.payload as { initialInput?: string } | undefined;
        const run = await this.runWorkflow(payload?.initialInput);
        return {
          ok: run.status === "done",
          data: run,
        };
      }

      return {
        ok: true,
        data: {
          command: command.name,
          receivedAt: new Date().toISOString(),
        },
      };
    },
  };

  bridge.sessions.create();
  return bridge;
}

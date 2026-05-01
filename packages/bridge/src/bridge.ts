import { createEmptyWorkflow, type Workflow } from "@specflow/workflow";
import type { BridgeCommand, BridgeCommandResult } from "./commands";
import { createBridgeRuntime, type BridgeRuntime } from "./runtime";
import { SessionRegistry } from "./sessions";

export interface SpecflowBridge {
  runtime: BridgeRuntime;
  sessions: SessionRegistry;
  workflow: Workflow;
  execute(command: BridgeCommand): Promise<BridgeCommandResult>;
}

export function createSpecflowBridge(): SpecflowBridge {
  const bridge: SpecflowBridge = {
    runtime: createBridgeRuntime(),
    sessions: new SessionRegistry(),
    workflow: createEmptyWorkflow("New Specflow workflow"),
    async execute(command) {
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

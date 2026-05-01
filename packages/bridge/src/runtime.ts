import { APP_NAME } from "@specflow/shared";

export interface BridgeRuntime {
  appName: string;
  startedAt: Date;
}

export function createBridgeRuntime(): BridgeRuntime {
  return {
    appName: APP_NAME,
    startedAt: new Date(),
  };
}

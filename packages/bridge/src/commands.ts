export interface BridgeCommand {
  name: string;
  payload?: unknown;
}

export interface BridgeCommandResult {
  ok: boolean;
  data?: unknown;
}

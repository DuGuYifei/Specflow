import type { GateDecision, GateNode } from "@specflow/workflow";

export function parseGateDecision(node: GateNode, output: string): GateDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.trim());
  } catch {
    throw new Error(`Gate node "${node.id}" returned invalid JSON.`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Gate node "${node.id}" returned an invalid decision object.`);
  }
  const decision = parsed as { branchId?: unknown; reason?: unknown };
  if (typeof decision.branchId !== "string" || !node.branches.some((branch) => branch.id === decision.branchId)) {
    throw new Error(`Gate node "${node.id}" selected an unknown branch.`);
  }
  if (decision.reason !== undefined && typeof decision.reason !== "string") {
    throw new Error(`Gate node "${node.id}" returned a non-string reason.`);
  }
  return {
    branchId: decision.branchId,
    ...(typeof decision.reason === "string" ? { reason: decision.reason } : {}),
  };
}

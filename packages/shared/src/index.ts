export const SPECFLOW_PRODUCT_NAME = "Specflow";
export const CONTINUOUS_CODING_CATEGORY = "Continuous Coding";
export const PHASE_ZERO_NAME = "Phase 0";

export const PHASE_ZERO_WORKFLOW_STEPS = [
  "ticket",
  "interview",
  "plan",
  "code draft",
  "implementation review",
  "repair loop",
  "final patch"
] as const;

export function formatPhaseZeroFlow(): string {
  return PHASE_ZERO_WORKFLOW_STEPS.join(" -> ");
}

export const SPECFLOW_PRODUCT_NAME = "Specflow";
export const CONTINUOUS_CODING_CATEGORY = "Continuous Coding";
export const LOCAL_FOUNDATION_STATUS = "local-foundation";

export const DEFAULT_WORKFLOW_STEPS = [
  "ticket",
  "interview",
  "plan",
  "code draft",
  "implementation review",
  "repair loop",
  "final patch"
] as const;

export function formatDefaultWorkflowFlow(): string {
  return DEFAULT_WORKFLOW_STEPS.join(" -> ");
}

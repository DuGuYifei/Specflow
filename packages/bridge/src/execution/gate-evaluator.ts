import type { GateDecision, GateNode } from "@specflow/workflow";

export interface GateEvaluationInput {
  node: GateNode;
  input: string;
  prompt: string;
}

export interface GateEvaluator {
  evaluate(input: GateEvaluationInput): Promise<GateDecision>;
}

export class DeterministicGateEvaluator implements GateEvaluator {
  async evaluate(input: GateEvaluationInput): Promise<GateDecision> {
    const normalizedInput = input.input.toLowerCase();
    const matchingBranch = input.node.branches.find((branch) => {
      return normalizedInput.includes(branch.id.toLowerCase())
        || normalizedInput.includes(branch.label.toLowerCase());
    });

    const fallbackBranch = input.node.branches[0];
    if (!matchingBranch && !fallbackBranch) {
      throw new Error(`Gate node "${input.node.id}" has no branches.`);
    }

    const branch = matchingBranch ?? fallbackBranch;
    return {
      branchId: branch.id,
      reason: matchingBranch
        ? `Matched branch "${branch.label}" from input.`
        : `Defaulted to first branch "${branch.label}".`,
    };
  }
}

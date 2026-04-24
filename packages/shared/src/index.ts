export const SPECFLOW_NAME = 'Specflow';
export const SPECFLOW_PHASE = 'phase-0';

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

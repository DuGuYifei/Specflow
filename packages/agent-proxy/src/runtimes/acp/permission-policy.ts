import type {
  AgentPermissionRequest,
  AgentPermissionResult,
  PermissionPolicy,
  PermissionTimeoutAction,
} from "../../types";

type PermissionOption = AgentPermissionRequest["options"][number];

const ALLOW_KIND_PRIORITY = ["allow_once", "allow_always"];
const DENY_KIND_PRIORITY = ["reject_once", "reject_always"];
const ALLOW_NAME_HINTS = ["allow", "approve", "accept", "yes", "ok"];
const DENY_NAME_HINTS = ["deny", "reject", "decline", "no"];

export function pickAllowOption(options: readonly PermissionOption[]): PermissionOption | undefined {
  return pickByKind(options, ALLOW_KIND_PRIORITY)
    ?? pickByNameHints(options, ALLOW_NAME_HINTS)
    ?? options[0];
}

export function pickDenyOption(options: readonly PermissionOption[]): PermissionOption | undefined {
  return pickByKind(options, DENY_KIND_PRIORITY)
    ?? pickByNameHints(options, DENY_NAME_HINTS)
    ?? options[options.length - 1];
}

export function resolveByTimeout(
  options: readonly PermissionOption[],
  action: PermissionTimeoutAction,
): AgentPermissionResult {
  const picked = action === "accept" ? pickAllowOption(options) : pickDenyOption(options);
  if (picked) return { outcome: "selected", optionId: picked.optionId };
  return { outcome: "cancelled" };
}

export function resolveByPolicy(
  options: readonly PermissionOption[],
  policy: PermissionPolicy | undefined,
): AgentPermissionResult | undefined {
  if (!policy) return undefined;
  if (policy.mode === "auto_accept") {
    const picked = pickAllowOption(options);
    return picked ? { outcome: "selected", optionId: picked.optionId } : undefined;
  }
  if (policy.mode === "auto_deny") {
    const picked = pickDenyOption(options);
    return picked ? { outcome: "selected", optionId: picked.optionId } : undefined;
  }
  return undefined;
}

function pickByKind(options: readonly PermissionOption[], priority: string[]): PermissionOption | undefined {
  for (const kind of priority) {
    const found = options.find((option) => option.kind === kind);
    if (found) return found;
  }
  return undefined;
}

function pickByNameHints(options: readonly PermissionOption[], hints: string[]): PermissionOption | undefined {
  for (const hint of hints) {
    const found = options.find((option) => (option.name ?? "").toLowerCase().includes(hint));
    if (found) return found;
  }
  return undefined;
}

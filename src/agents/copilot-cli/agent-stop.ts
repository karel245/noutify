import type { WaitingHookPayload } from "../waiting-hook.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCopilotAgentStopPayload(
  input: string,
): WaitingHookPayload {
  try {
    const value: unknown = JSON.parse(input);
    if (!isRecord(value)) return { valid: false, recursive: false };

    const native = Object.hasOwn(value, "stopReason");
    const compatible =
      Object.hasOwn(value, "hook_event_name") ||
      Object.hasOwn(value, "stop_reason");
    if (native === compatible || Object.hasOwn(value, "hookEventName")) {
      return { valid: false, recursive: false };
    }

    const valid = native
      ? value.stopReason === "end_turn"
      : value.hook_event_name === "Stop" && value.stop_reason === "end_turn";
    return { valid, recursive: valid && value.stop_hook_active === true };
  } catch {
    return { valid: false, recursive: false };
  }
}

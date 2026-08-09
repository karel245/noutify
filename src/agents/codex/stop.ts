import type { WaitingHookPayload } from "../waiting-hook.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCodexStopPayload(input: string): WaitingHookPayload {
  if (!input.trim()) return { valid: false, recursive: false };

  try {
    const value: unknown = JSON.parse(input);
    if (!isRecord(value)) return { valid: false, recursive: false };
    if ("hook_event_name" in value && value.hook_event_name !== "Stop") {
      return { valid: false, recursive: false };
    }
    return { valid: true, recursive: value.stop_hook_active === true };
  } catch {
    return { valid: false, recursive: false };
  }
}
